/**
 * Core routing engine — the shared brain consumed by the plugin (and optionally the standalone proxy).
 *
 * Handles: smart routing → provider lookup → pricing → cheapest-first sort → failover → translate.
 * Payment mode is injected via the PaymentBackend interface.
 */

import { ProviderRegistry } from './providers/registry.js';
import { probeAllPricing, sortProvidersByPrice } from './providers/pricing.js';
import { executeWithFailover, type FailoverResult } from './providers/failover.js';
import { RequirementsCache } from './cache/requirements.js';
import { DedupCache } from './cache/dedup.js';
import { ResponseCache, type CachedResponse } from './cache/response.js';
import { probePathForFormat } from './providers/translate/index.js';
import { makeRoutingDecision, type RoutingDecision } from './router/strategy.js';
import { SpendController, type SpendLimits } from './payment/spend-control.js';
import { loadRoutingConfig } from './config/loader.js';
import { createPaymentBackend } from './payment/interface.js';
import type {
  PaymentBackend,
  PaymentMode,
  RoutingProfile,
  ProviderConfig,
  ChatCompletionRequest,
} from './types.js';
import { logger } from './logger.js';

export interface EngineConfig {
  mode: PaymentMode;
  routingProfile: RoutingProfile;
  routingConfigPath?: string;
  // Obul mode
  obulApiKey?: string;
  obulBaseUrl?: string;
  // Wallet mode
  walletMnemonic?: string;
  // Spend controls
  spendLimits?: SpendLimits;
}

export interface RouteResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  stream?: ReadableStream;
  provider: ProviderConfig;
  failoverCount: number;
  routing: RoutingDecision;
  cached: boolean;
}

export class RoutingEngine {
  readonly registry: ProviderRegistry;
  readonly requirementsCache: RequirementsCache;
  readonly dedupCache: DedupCache;
  readonly responseCache: ResponseCache;
  readonly paymentBackend: PaymentBackend;
  readonly spendController: SpendController;
  readonly mode: PaymentMode;
  readonly routingProfile: RoutingProfile;

  constructor(config: EngineConfig) {
    this.mode = config.mode;
    this.routingProfile = config.routingProfile;

    const routingConfig = loadRoutingConfig(config.routingConfigPath);
    this.registry = new ProviderRegistry(routingConfig);
    this.requirementsCache = new RequirementsCache();
    this.dedupCache = new DedupCache();
    this.responseCache = new ResponseCache();
    this.spendController = new SpendController(config.spendLimits ?? {});

    this.paymentBackend = createPaymentBackend({
      mode: config.mode,
      obulApiKey: config.obulApiKey,
      obulBaseUrl: config.obulBaseUrl,
      walletMnemonic: config.walletMnemonic,
    });
  }

  /**
   * Initialize async resources (e.g., wallet key derivation).
   */
  async initialize(): Promise<void> {
    if (this.mode === 'wallet') {
      const { WalletPaymentBackend } = await import('./payment/wallet.js');
      if (this.paymentBackend instanceof WalletPaymentBackend) {
        const info = await this.paymentBackend.initialize();
        logger.info('Wallet initialized', { address: info.address });
      }
    }
  }

  /**
   * Route a chat completion request through the full pipeline.
   *
   * 1. Smart routing (classify → pick model)
   * 2. Provider lookup
   * 3. Response cache check
   * 4. Request dedup check
   * 5. Pricing probes (parallel, 2s timeout)
   * 6. Cheapest-first sort
   * 7. Spend control
   * 8. Force-provider override
   * 9. Failover loop
   * 10. Cache result
   */
  async route(
    request: ChatCompletionRequest,
    options?: {
      forceProvider?: string;
      stream?: boolean;
    },
  ): Promise<RouteResult> {
    const isStream = options?.stream ?? request.stream === true;

    // 1. Smart routing
    const routing = makeRoutingDecision(
      request,
      this.routingProfile,
      this.registry.listModels(),
    );
    const model = routing.model;

    if (routing.classification) {
      logger.debug('Smart routing', {
        tier: routing.classification.tier,
        confidence: routing.classification.confidence.toFixed(2),
        model,
      });
    }

    // 2. Provider lookup
    const categoryResult = this.registry.getCategoryForModel(model);
    if (!categoryResult) {
      return this.errorResult(404, `Model "${model}" not found`, routing);
    }

    let providers = this.registry.getProvidersForModel(model);
    if (providers.length === 0) {
      return this.errorResult(404, `No enabled providers for model "${model}"`, routing);
    }

    const rawBody = Buffer.from(JSON.stringify(request));

    // 3. Response cache (non-streaming only)
    const cacheKey = ResponseCache.buildKey(model, rawBody);
    if (!isStream) {
      const cached = this.responseCache.get(cacheKey);
      if (cached) {
        logger.debug('Response cache hit', { model });
        return this.cachedResult(cached, routing);
      }
    }

    // 4. Dedup (non-streaming only)
    if (!isStream) {
      const inflight = this.dedupCache.get(DedupCache.buildKey(rawBody));
      if (inflight) {
        logger.debug('Dedup hit', { model });
        try {
          const resp = await inflight;
          return {
            status: resp.status,
            headers: { ...resp.headers, 'x-dedup': 'HIT' },
            body: resp.body,
            provider: providers[0],
            failoverCount: 0,
            routing,
            cached: false,
          };
        } catch {
          // Fall through
        }
      }
    }

    // 5. Pricing probes
    const prices = await probeAllPricing(
      providers, model, this.requirementsCache, this.paymentBackend, 2000,
    );

    // 6. Cheapest-first sort
    providers = sortProvidersByPrice(providers, prices);

    // 7. Spend control
    const cheapestPrice = prices.get(providers[0]?.id) ?? null;
    if (cheapestPrice !== null) {
      const check = this.spendController.canSpend(cheapestPrice);
      if (!check.allowed) {
        return this.errorResult(429, `Spend limit exceeded: ${check.reason}`, routing);
      }
    }

    // 8. Force-provider override
    if (options?.forceProvider) {
      const forced = providers.find((p) => p.id === options.forceProvider);
      if (forced) {
        providers = [forced, ...providers.filter((p) => p.id !== options.forceProvider)];
      }
    }

    // 9. Failover loop
    const executionPromise = executeWithFailover({
      providers,
      categoryId: categoryResult.categoryId,
      model,
      clientPath: '/v1/chat/completions',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: rawBody,
      stream: isStream,
      paymentBackend: this.paymentBackend,
      isNegativeCached: (providerId: string) => {
        const provider = providers.find((p) => p.id === providerId);
        if (!provider) return false;
        const probePath = probePathForFormat(provider.api_format, model);
        const key = RequirementsCache.buildKey(provider, probePath);
        return this.requirementsCache.isNegativeCached(key);
      },
    });

    // Register dedup
    if (!isStream) {
      this.dedupCache.set(
        DedupCache.buildKey(rawBody),
        executionPromise.then((r) => r.response),
      );
    }

    const result = await executionPromise;

    // Record spend
    if (result.response.status >= 200 && result.response.status < 300) {
      const spent = prices.get(result.provider.id);
      if (spent !== null && spent !== undefined) {
        this.spendController.recordSpend(spent);
      }
    }

    // 10. Cache successful non-streaming responses
    if (!isStream && result.response.status >= 200 && result.response.status < 300) {
      this.responseCache.set(cacheKey, {
        status: result.response.status,
        headers: result.response.headers,
        body: result.response.body,
        providerId: result.provider.id,
        cachedAt: Date.now(),
      });
    }

    return {
      status: result.response.status,
      headers: result.response.headers,
      body: result.response.body,
      stream: result.response.stream,
      provider: result.provider,
      failoverCount: result.failoverCount,
      routing,
      cached: false,
    };
  }

  private errorResult(status: number, message: string, routing: RoutingDecision): RouteResult {
    return {
      status,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ error: { message, type: 'invalid_request_error' } })),
      provider: { id: 'none', name: 'none', scheme: 'https', host: '', path_prefix: '', api_format: 'openai', priority: 999, enabled: false, dynamic_pricing: false, headers: {} },
      failoverCount: 0,
      routing,
      cached: false,
    };
  }

  private cachedResult(cached: CachedResponse, routing: RoutingDecision): RouteResult {
    return {
      status: cached.status,
      headers: { ...cached.headers, 'x-cache': 'HIT' },
      body: cached.body,
      provider: { id: cached.providerId, name: cached.providerId, scheme: 'https', host: '', path_prefix: '', api_format: 'openai', priority: 0, enabled: true, dynamic_pricing: false, headers: {} },
      failoverCount: 0,
      routing,
      cached: true,
    };
  }
}
