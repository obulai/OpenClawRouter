import type {
  TranslateContext,
  TranslatedRequest,
  ChatCompletionRequest,
  ChatMessage,
  ChatUsage,
  ChatCompletionResponse,
  ChatChoice,
} from "../../types.js";
import { normalizeUpstreamModel } from "./vendor.js";
import { v4 as uuidv4 } from "uuid";

interface X402EngineRequest {
  messages: ChatMessage[];
  max_tokens?: number;
}

interface X402EngineResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Map canonical model name to x402engine's URL slug. */
export function engineSlug(model: string): string {
  switch (model) {
    // Anthropic
    case "claude-opus-4-6":
      return "claude-opus";
    case "claude-sonnet-4-6":
      return "claude-sonnet-4.6";
    case "claude-haiku-4-5":
      return "claude-haiku";
    // OpenAI
    case "gpt-4o":
      return "gpt-4o";
    case "gpt-5":
      return "gpt-5";
    // Google
    case "gemini-3.1-pro":
      return "gemini-3.1-pro";
    case "gemini-3.1-flash-lite":
      return "gemini-3.1-flash-lite";
    // DeepSeek
    case "deepseek-v3.2":
      return "deepseek-v3.2";
    // xAI
    case "grok-4":
      return "grok";
    // MiniMax
    case "minimax-m2.5":
      return "minimax";
    case "minimax-m2.7":
      return "minimax";
    // Fallback: use as-is
    default:
      return model;
  }
}

/** Translate OpenAI request -> x402engine request. */
export function translateRequest(
  ctx: TranslateContext,
  body: Buffer
): TranslatedRequest {
  const openaiReq: ChatCompletionRequest = JSON.parse(body.toString());

  const clientWantsStream = openaiReq.stream ?? false;

  const engineReq: X402EngineRequest = {
    messages: openaiReq.messages,
  };
  if (openaiReq.max_tokens !== undefined) {
    engineReq.max_tokens = openaiReq.max_tokens;
  }

  const slug = engineSlug(ctx.model);
  const pathOverride = `/api/llm/${slug}`;

  return {
    body: Buffer.from(JSON.stringify(engineReq)),
    pathOverride,
    stripStreaming: clientWantsStream,
  };
}

/** Build a single-choice ChatCompletionResponse from plain text. */
function buildSingleResponse(
  model: string,
  content: string,
  usage?: ChatUsage
): ChatCompletionResponse {
  return {
    id: `chatcmpl-${uuidv4()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage,
  };
}

/** Translate x402engine response -> OpenAI response. */
export function translateResponse(body: Buffer, status: number): Buffer {
  if (status < 200 || status >= 300) {
    return body;
  }

  const engineResp: X402EngineResponse = JSON.parse(body.toString());

  const usage: ChatUsage | undefined = engineResp.usage
    ? {
        prompt_tokens: engineResp.usage.prompt_tokens,
        completion_tokens: engineResp.usage.completion_tokens,
        total_tokens: engineResp.usage.total_tokens,
      }
    : undefined;

  const canonicalModel = normalizeUpstreamModel(engineResp.model);
  const openaiResp = buildSingleResponse(
    canonicalModel,
    engineResp.content,
    usage
  );

  return Buffer.from(JSON.stringify(openaiResp));
}
