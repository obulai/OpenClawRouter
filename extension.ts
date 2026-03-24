/**
 * OpenClaw plugin entry point for OpenClawRouter.
 *
 * Registers:
 * - HTTP route: /v1/chat/completions (OpenAI-compatible, multi-provider routing)
 * - HTTP route: /v1/models (list available models)
 * - Hook: before_model_resolve (smart routing — auto model selection)
 * - Command: /providers (list providers for a model)
 * - Command: /routing (show current routing profile and stats)
 */

import { RoutingEngine } from "./src/engine.js";
import { classifyRequest } from "./src/router/classifier.js";
import { selectModelForTier } from "./src/router/selector.js";
import type { PaymentMode, RoutingProfile, ChatCompletionRequest } from "./src/types.js";

export default function register(api: any) {
  const config = api.pluginConfig ?? {};
  const log = api.logger ?? console;

  // Resolve config from plugin config → env vars → defaults
  const mode: PaymentMode = config.mode ?? process.env.OPENCLAWROUTER_MODE ?? "obul";
  const routingProfile: RoutingProfile =
    config.routingProfile ?? process.env.OPENCLAWROUTER_PROFILE ?? "auto";
  const obulApiKey = config.obulApiKey ?? process.env.OBUL_API_KEY;
  const obulBaseUrl =
    config.obulBaseUrl ?? process.env.OBUL_BASE_URL ?? "https://obul.polymerdao.xyz";
  const walletMnemonic = config.walletMnemonic ?? process.env.OPENCLAWROUTER_WALLET_MNEMONIC;

  if (mode === "obul" && !obulApiKey) {
    log.warn(
      "OpenClawRouter: OBUL_API_KEY not set — obul mode will fail. Set it in env or plugin config.",
    );
  }

  // Build the routing engine
  let engine: RoutingEngine;
  try {
    engine = new RoutingEngine({
      mode,
      routingProfile,
      routingConfigPath: config.routingConfigPath,
      obulApiKey,
      obulBaseUrl,
      walletMnemonic,
      spendLimits: {
        maxPerRequest: config.maxPerRequest ?? envInt("OPENCLAWROUTER_MAX_PER_REQUEST"),
        maxHourly: config.maxHourly ?? envInt("OPENCLAWROUTER_MAX_HOURLY"),
        maxDaily: config.maxDaily ?? envInt("OPENCLAWROUTER_MAX_DAILY"),
      },
    });
  } catch (err: any) {
    log.error(`OpenClawRouter: Failed to initialize routing engine: ${err.message}`);
    return;
  }

  // Async init (wallet key derivation) — fire and forget, log errors
  engine.initialize().catch((err: any) => {
    log.error(`OpenClawRouter: Async init failed: ${err.message}`);
  });

  const models = engine.registry.listModels();
  log.info(
    `OpenClawRouter: ${models.length} models, ${mode} mode, ${routingProfile} profile`,
  );

  // ── HTTP Routes ──────────────────────────────────────────────────────

  // POST /v1/chat/completions — the main multi-provider routing endpoint
  api.registerHttpRoute({
    path: "/v1/chat/completions",
    handler: async (req: any, res: any) => {
      try {
        let body: any;
        if (typeof req.body === "string") {
          body = JSON.parse(req.body);
        } else if (Buffer.isBuffer(req.body)) {
          body = JSON.parse(req.body.toString());
        } else {
          body = req.body;
        }

        if (!body || !body.messages) {
          return res.status(400).json({
            error: {
              message: "Invalid request: missing messages",
              type: "invalid_request_error",
            },
          });
        }

        const request: ChatCompletionRequest = body;
        const isStream = request.stream === true;
        const forceProvider = req.headers?.["x-force-provider"] as string | undefined;

        const result = await engine.route(request, { forceProvider, stream: isStream });

        // Set response headers
        res.setHeader("x-provider", result.provider.id);
        res.setHeader("x-mode", engine.mode);
        res.setHeader("x-failover-count", String(result.failoverCount));
        if (result.routing.classification) {
          res.setHeader("x-routing-tier", result.routing.classification.tier);
        }
        if (result.cached) {
          res.setHeader("x-cache", "HIT");
        }

        // Stream or buffer
        if (isStream && result.stream) {
          res.setHeader("content-type", "text/event-stream");
          res.setHeader("cache-control", "no-cache");
          res.setHeader("connection", "keep-alive");
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
          const contentType = result.headers["content-type"] ?? "application/json";
          res.setHeader("content-type", contentType);
          res.status(result.status).send(result.body);
        }
      } catch (err: any) {
        log.error(`OpenClawRouter: ${err.message}`);
        res.status(500).json({
          error: { message: "Internal server error", type: "server_error" },
        });
      }
    },
  });

  // GET /v1/models — list available models
  api.registerHttpRoute({
    path: "/v1/models",
    handler: async (_req: any, res: any) => {
      const allModels = engine.registry.listModels();
      res.json({
        object: "list",
        data: allModels.map((id: string) => ({
          id,
          object: "model",
          owned_by: "openclawrouter",
        })),
      });
    },
  });

  // ── Smart Routing Hook ───────────────────────────────────────────────

  // Intercept model resolution: when model is "auto", classify and pick
  api.on("before_model_resolve", async (event: any, _ctx: any) => {
    const model = event.model?.trim();
    if (!model || model === "auto" || model === "openclawrouter") {
      // Classify the request and pick the right model
      const messages = event.messages ?? [];
      if (messages.length === 0) return;

      const request: ChatCompletionRequest = {
        model: "auto",
        messages,
      };

      const classification = classifyRequest(request);
      const selectedModel = selectModelForTier(classification.tier, routingProfile);

      log.info(
        `OpenClawRouter: auto-routed to ${selectedModel} (${classification.tier}, confidence=${classification.confidence.toFixed(2)})`,
      );

      return { model: selectedModel };
    }
  });

  // ── Slash Commands ───────────────────────────────────────────────────

  // /providers — list providers for a model
  api.registerCommand({
    name: "providers",
    description: "List x402 providers for a model (usage: /providers claude-sonnet-4-6)",
    acceptsArgs: true,
    handler: async (ctx: any) => {
      const model = ctx.args?.trim();
      if (!model) {
        const allModels = engine.registry.listModels();
        return {
          text: `Available models:\n${allModels.map((m: string) => `  • ${m}`).join("\n")}\n\nUsage: /providers <model>`,
        };
      }

      const providers = engine.registry.getProvidersForModel(model);
      if (providers.length === 0) {
        return { text: `No providers found for model: ${model}` };
      }

      const lines = providers.map(
        (p: any) =>
          `  • ${p.id} (${p.name}) — ${p.scheme}://${p.host}${p.path_prefix} [${p.api_format}] priority=${p.priority}${p.dynamic_pricing ? " dynamic" : ""}`,
      );
      return {
        text: `Providers for ${model}:\n${lines.join("\n")}`,
      };
    },
  });

  // /routing — show routing profile and stats
  api.registerCommand({
    name: "routing",
    description: "Show OpenClawRouter routing profile and cache stats",
    acceptsArgs: false,
    handler: async () => {
      return {
        text: [
          `OpenClawRouter Status`,
          `  Mode: ${engine.mode}`,
          `  Profile: ${engine.routingProfile}`,
          `  Models: ${engine.registry.listModels().length}`,
          `  Dedup in-flight: ${engine.dedupCache.size}`,
          `  Response cache: ${engine.responseCache.size}`,
        ].join("\n"),
      };
    },
  });
}

function envInt(name: string): number | undefined {
  const val = process.env[name];
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}
