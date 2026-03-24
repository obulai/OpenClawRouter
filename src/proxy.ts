import express from 'express';
import { ProviderRegistry } from './providers/registry.js';
import { probeAllPricing, sortProvidersByPrice } from './providers/pricing.js';
import { executeWithFailover } from './providers/failover.js';
import { RequirementsCache } from './cache/requirements.js';
import { DedupCache } from './cache/dedup.js';
import { ResponseCache } from './cache/response.js';
import { probePathForFormat } from './providers/translate/index.js';
import { makeRoutingDecision } from './router/strategy.js';
import { SpendController } from './payment/spend-control.js';
import type { PaymentBackend, PaymentMode, RoutingProfile, ChatCompletionRequest } from './types.js';
import { logger } from './logger.js';

export interface ProxyServerOptions {
  port: number;
  paymentBackend: PaymentBackend;
  registry: ProviderRegistry;
  requirementsCache: RequirementsCache;
  mode: PaymentMode;
  routingProfile: RoutingProfile;
  spendController?: SpendController;
}

/**
 * Create the Express proxy application (without starting it).
 */
export function createProxyServer(options: ProxyServerOptions): express.Application {
  const {
    registry,
    requirementsCache,
    paymentBackend,
    mode,
    routingProfile,
    spendController,
  } = options;

  const app = express();
  const dedupCache = new DedupCache();
  const responseCache = new ResponseCache();

  // Parse raw JSON bodies — we need the raw Buffer for forwarding
  app.use(express.raw({ type: 'application/json', limit: '10mb' }));

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode,
      profile: routingProfile,
      models: registry.listModels().length,
      dedupInflight: dedupCache.size,
      responseCacheSize: responseCache.size,
    });
  });

  // OpenAI-compatible model list
  app.get('/v1/models', (_req, res) => {
    const models = registry.listModels();
    res.json({
      object: 'list',
      data: models.map((id) => ({
        id,
        object: 'model',
        owned_by: 'openclawrouter',
      })),
    });
  });

  // Main chat completions endpoint
  app.post('/v1/chat/completions', async (req, res) => {
    try {
      // 1. Parse request body
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      let parsed: ChatCompletionRequest;
      try {
        parsed = JSON.parse(rawBody.toString());
      } catch {
        res.status(400).json({
          error: { message: 'Invalid JSON in request body', type: 'invalid_request_error', code: 'invalid_json' },
        });
        return;
      }

      if (typeof parsed !== 'object' || parsed === null || !parsed.messages) {
        res.status(400).json({
          error: { message: 'Invalid request: missing messages', type: 'invalid_request_error', code: 'invalid_request' },
        });
        return;
      }

      const isStream = parsed.stream === true;

      // 2. Smart routing — resolve model
      const routingDecision = makeRoutingDecision(
        parsed,
        routingProfile,
        registry.listModels(),
      );
      const model = routingDecision.model;

      if (routingDecision.classification) {
        logger.debug('Smart routing', {
          tier: routingDecision.classification.tier,
          confidence: routingDecision.classification.confidence.toFixed(2),
          model,
        });
      }

      // 3. Look up providers
      const categoryResult = registry.getCategoryForModel(model);
      if (!categoryResult) {
        res.status(404).json({
          error: { message: `Model "${model}" not found`, type: 'invalid_request_error', code: 'model_not_found' },
        });
        return;
      }

      let providers = registry.getProvidersForModel(model);
      if (providers.length === 0) {
        res.status(404).json({
          error: { message: `No enabled providers for model "${model}"`, type: 'invalid_request_error', code: 'no_providers' },
        });
        return;
      }

      // 4. Check response cache (non-streaming only)
      const cacheKey = ResponseCache.buildKey(model, rawBody);
      if (!isStream) {
        const cached = responseCache.get(cacheKey);
        if (cached) {
          logger.debug('Response cache hit', { model });
          res.setHeader('x-provider', cached.providerId);
          res.setHeader('x-mode', mode);
          res.setHeader('x-cache', 'HIT');
          res.setHeader('x-failover-count', '0');
          res.setHeader('content-type', cached.headers['content-type'] ?? 'application/json');
          res.status(cached.status).send(cached.body);
          return;
        }
      }

      // 5. Request deduplication (non-streaming only)
      const dedupKey = DedupCache.buildKey(rawBody);
      if (!isStream) {
        const inflight = dedupCache.get(dedupKey);
        if (inflight) {
          logger.debug('Dedup hit — sharing in-flight request', { model });
          try {
            const result = await inflight;
            res.setHeader('x-mode', mode);
            res.setHeader('x-dedup', 'HIT');
            res.setHeader('content-type', result.headers['content-type'] ?? 'application/json');
            res.status(result.status).send(result.body);
            return;
          } catch (err) {
            logger.debug('Dedup shared request failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            // Fall through to normal flow
          }
        }
      }

      // 6. Probe pricing (parallel, 2s timeout)
      const prices = await probeAllPricing(providers, model, requirementsCache, paymentBackend, 2000);

      // 7. Sort cheapest-first
      providers = sortProvidersByPrice(providers, prices);

      // 8. Spend control check
      if (spendController) {
        // Use the cheapest known price for the check
        const cheapestPrice = prices.get(providers[0]?.id) ?? null;
        if (cheapestPrice !== null) {
          const check = spendController.canSpend(cheapestPrice);
          if (!check.allowed) {
            res.status(429).json({
              error: {
                message: `Spend limit exceeded: ${check.reason}`,
                type: 'rate_limit_error',
                code: 'spend_limit_exceeded',
              },
            });
            return;
          }
        }
      }

      // 9. Check for x-force-provider header override
      const forceProvider = req.headers['x-force-provider'] as string | undefined;
      if (forceProvider) {
        const forced = providers.find((p) => p.id === forceProvider);
        if (forced) {
          providers = [forced, ...providers.filter((p) => p.id !== forceProvider)];
        } else {
          logger.warn('Forced provider not found, ignoring', { forceProvider });
        }
      }

      // Build request headers to forward (filter out hop-by-hop)
      const forwardHeaders: Record<string, string> = {
        'content-type': 'application/json',
      };
      // Forward authorization if present
      const authHeader = req.headers['authorization'] as string | undefined;
      if (authHeader) {
        forwardHeaders['authorization'] = authHeader;
      }

      // 10. Build the execution promise (may be shared via dedup)
      const executionPromise = executeWithFailover({
        providers,
        categoryId: categoryResult.categoryId,
        model,
        clientPath: '/v1/chat/completions',
        method: 'POST',
        headers: forwardHeaders,
        body: rawBody,
        stream: isStream,
        paymentBackend,
        isNegativeCached: (providerId: string) => {
          const provider = providers.find((p) => p.id === providerId);
          if (!provider) return false;
          const probePath = probePathForFormat(provider.api_format, model);
          const key = RequirementsCache.buildKey(provider, probePath);
          return requirementsCache.isNegativeCached(key);
        },
      });

      // Register in dedup cache for non-streaming requests
      if (!isStream) {
        dedupCache.set(dedupKey, executionPromise.then((r) => r.response));
      }

      const result = await executionPromise;

      // Record spend if applicable
      if (spendController && result.response.status >= 200 && result.response.status < 300) {
        const spent = prices.get(result.provider.id);
        if (spent !== null && spent !== undefined) {
          spendController.recordSpend(spent);
        }
      }

      // Cache successful non-streaming responses
      if (!isStream && result.response.status >= 200 && result.response.status < 300) {
        responseCache.set(cacheKey, {
          status: result.response.status,
          headers: result.response.headers,
          body: result.response.body,
          providerId: result.provider.id,
          cachedAt: Date.now(),
        });
      }

      // 11. Add response headers
      res.setHeader('x-provider', result.provider.id);
      res.setHeader('x-mode', mode);
      res.setHeader('x-failover-count', String(result.failoverCount));
      if (routingDecision.classification) {
        res.setHeader('x-routing-tier', routingDecision.classification.tier);
      }

      // 12. Return response
      if (isStream && result.response.stream) {
        // SSE streaming response
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.setHeader('connection', 'keep-alive');
        res.status(result.response.status);

        const reader = (result.response.stream as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } catch (err) {
          logger.error('Stream error', { error: err instanceof Error ? err.message : String(err) });
        } finally {
          res.end();
        }
      } else {
        // Non-streaming response
        const contentType = result.response.headers['content-type'] ?? 'application/json';
        res.setHeader('content-type', contentType);
        res.status(result.response.status).send(result.response.body);
      }
    } catch (err) {
      logger.error('Unhandled error in chat completions', {
        error: err instanceof Error ? err.message : String(err),
      });
      res.status(500).json({
        error: { message: 'Internal server error', type: 'server_error', code: 'internal_error' },
      });
    }
  });

  return app;
}

/**
 * Start the proxy server and listen on the configured port.
 */
export async function startProxyServer(options: ProxyServerOptions): Promise<void> {
  const app = createProxyServer(options);

  return new Promise((resolve) => {
    app.listen(options.port, () => {
      logger.info(`OpenClawRouter listening on http://localhost:${options.port}`);
      resolve();
    });
  });
}
