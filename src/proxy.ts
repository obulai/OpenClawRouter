/**
 * Standalone Express proxy — optional wrapper around the RoutingEngine.
 * The primary integration is the OpenClaw plugin (extension.ts).
 * This exists for standalone / non-OpenClaw usage.
 */

import express from 'express';
import { RoutingEngine, type EngineConfig } from './engine.js';
import type { ChatCompletionRequest } from './types.js';
import { logger } from './logger.js';

export interface ProxyServerOptions extends EngineConfig {
  port: number;
}

export function createProxyServer(options: ProxyServerOptions): express.Application {
  const engine = new RoutingEngine(options);
  const app = express();

  app.use(express.raw({ type: 'application/json', limit: '10mb' }));

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: engine.mode,
      profile: engine.routingProfile,
      models: engine.registry.listModels().length,
      dedupInflight: engine.dedupCache.size,
      responseCacheSize: engine.responseCache.size,
    });
  });

  app.get('/v1/models', (_req, res) => {
    res.json({
      object: 'list',
      data: engine.registry.listModels().map((id) => ({
        id,
        object: 'model',
        owned_by: 'openclawrouter',
      })),
    });
  });

  app.post('/v1/chat/completions', async (req, res) => {
    try {
      const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
      let parsed: ChatCompletionRequest;
      try {
        parsed = JSON.parse(rawBody.toString());
      } catch {
        res.status(400).json({
          error: { message: 'Invalid JSON', type: 'invalid_request_error' },
        });
        return;
      }

      if (!parsed?.messages) {
        res.status(400).json({
          error: { message: 'Missing messages', type: 'invalid_request_error' },
        });
        return;
      }

      const isStream = parsed.stream === true;
      const forceProvider = req.headers['x-force-provider'] as string | undefined;

      const result = await engine.route(parsed, { forceProvider, stream: isStream });

      res.setHeader('x-provider', result.provider.id);
      res.setHeader('x-mode', engine.mode);
      res.setHeader('x-failover-count', String(result.failoverCount));
      if (result.routing.classification) {
        res.setHeader('x-routing-tier', result.routing.classification.tier);
      }
      if (result.cached) {
        res.setHeader('x-cache', 'HIT');
      }

      if (isStream && result.stream) {
        res.setHeader('content-type', 'text/event-stream');
        res.setHeader('cache-control', 'no-cache');
        res.status(result.status);
        const reader = (result.stream as ReadableStream<Uint8Array>).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          res.end();
        }
      } else {
        res.setHeader('content-type', result.headers['content-type'] ?? 'application/json');
        res.status(result.status).send(result.body);
      }
    } catch (err) {
      logger.error('Unhandled error', { error: err instanceof Error ? err.message : String(err) });
      res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
    }
  });

  return app;
}

export async function startProxyServer(options: ProxyServerOptions): Promise<void> {
  const engine = new RoutingEngine(options);
  await engine.initialize();

  const app = createProxyServer(options);
  return new Promise((resolve) => {
    app.listen(options.port, () => {
      logger.info(`OpenClawRouter listening on http://localhost:${options.port}`);
      resolve();
    });
  });
}
