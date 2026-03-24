/**
 * OpenClawRouter — multi-provider AI model router with x402 payment.
 *
 * Primary usage: OpenClaw plugin (extension.ts)
 * Secondary usage: standalone proxy (cli.ts → proxy.ts)
 * Programmatic usage: import { RoutingEngine } from 'openclawrouter'
 */

export { RoutingEngine, type EngineConfig, type RouteResult } from './engine.js';
export { ProviderRegistry } from './providers/registry.js';
export { classifyRequest, type ClassificationResult } from './router/classifier.js';
export { selectModelForTier, selectModelWithFallback } from './router/selector.js';
export { makeRoutingDecision, type RoutingDecision } from './router/strategy.js';
export { loadRoutingConfig } from './config/loader.js';
export { createPaymentBackend } from './payment/interface.js';
export { ObulPaymentBackend } from './payment/obul.js';
export { SpendController, type SpendLimits } from './payment/spend-control.js';

export type {
  PaymentMode,
  RoutingProfile,
  ApiFormat,
  ComplexityTier,
  OpenClawRouterConfig,
  ProviderConfig,
  Category,
  RoutingConfig,
  PaymentBackend,
  ProviderResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  TranslateContext,
  TranslatedRequest,
} from './types.js';
