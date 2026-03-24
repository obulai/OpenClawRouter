export type PaymentMode = "obul" | "wallet";
export type RoutingProfile = "auto" | "eco" | "premium" | "agentic";
export type ApiFormat = "openai" | "x402engine" | "blockrun" | "askclaude" | "spraay";
export type ComplexityTier = "simple" | "medium" | "complex" | "reasoning";

export interface OpenClawRouterConfig {
  mode: PaymentMode;
  port: number;
  obul_api_key?: string;
  obul_base_url: string;
  wallet_path?: string;
  routing_profile: RoutingProfile;
  routing_config_path?: string;
  max_per_request?: number;
  max_hourly?: number;
  max_daily?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  scheme: "https" | "http";
  host: string;
  path_prefix: string;
  api_format: ApiFormat;
  priority: number;
  enabled: boolean;
  dynamic_pricing: boolean;
  headers: Record<string, string>;
}

export interface Category {
  display_name: string;
  description?: string;
  model: string;
  providers: ProviderConfig[];
}

export interface RoutingConfig {
  categories: Record<string, Category>;
}

export interface TranslateContext {
  format: ApiFormat;
  categoryId: string;
  model: string;
  clientPath: string;
}

export interface TranslatedRequest {
  body: Buffer;
  pathOverride?: string;
  stripStreaming: boolean;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  max_tokens?: number;
  stream?: boolean;
  [key: string]: unknown;
}

export interface ChatMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created?: number;
  model: string;
  choices: ChatChoice[];
  usage?: ChatUsage;
  [key: string]: unknown;
}

export interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason?: string;
  [key: string]: unknown;
}

export interface ChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  [key: string]: unknown;
}

export interface ProviderResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  stream?: ReadableStream;
}

export interface PaymentBackend {
  sendRequest(params: {
    provider: ProviderConfig;
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Buffer;
    stream: boolean;
  }): Promise<ProviderResponse>;
}
