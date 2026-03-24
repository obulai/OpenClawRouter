import type {
  ApiFormat,
  TranslateContext,
  TranslatedRequest,
} from "../../types.js";
import * as openai from "./openai.js";
import * as x402engine from "./x402engine.js";
import * as blockrun from "./blockrun.js";
import * as askclaude from "./askclaude.js";
import * as spraay from "./spraay.js";

export { vendorPrefix, stripVendorPrefix, hyphensToDots, dotsToHyphens, stripDateSuffix, normalizeUpstreamModel } from "./vendor.js";
export { engineSlug } from "./x402engine.js";
export { probePathSegment } from "./askclaude.js";

/**
 * Returns the default probe path for a given API format and model.
 */
export function probePathForFormat(format: ApiFormat, model: string): string {
  if (model.length === 0) {
    return "/v1/chat/completions";
  }
  switch (format) {
    case "x402engine": {
      const slug = x402engine.engineSlug(model);
      return `/api/llm/${slug}`;
    }
    case "askclaude": {
      const segment = askclaude.probePathSegment(model);
      return `/ask/${segment}`;
    }
    default:
      return "/v1/chat/completions";
  }
}

/** Returns true if the client path is a chat completions endpoint. */
function isChatCompletionsPath(path: string): boolean {
  const normalized = path.replace(/\/+$/, "");
  return normalized.endsWith("/chat/completions");
}

/**
 * Enforce the category model in the request body.
 * Rewrites the `model` field so every provider receives the category model.
 */
export function enforceCategoryModel(body: Buffer, model: string): Buffer {
  const parsed = JSON.parse(body.toString());
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("request body must be a JSON object");
  }

  // Skip re-serialization if already matches
  if (parsed.model === model) {
    return body;
  }

  parsed.model = model;
  return Buffer.from(JSON.stringify(parsed));
}

/**
 * Translate a client request body for the target provider format.
 *
 * Non-LLM categories and non-chat-completion endpoints pass through unchanged.
 */
export function translateRequest(
  ctx: TranslateContext,
  body: Buffer
): TranslatedRequest {
  // Only translate chat completion requests for LLM categories.
  if (
    !ctx.categoryId.startsWith("llm/") ||
    !isChatCompletionsPath(ctx.clientPath)
  ) {
    return {
      body,
      pathOverride: undefined,
      stripStreaming: false,
    };
  }

  // Enforce category model before format-specific translation.
  let effectiveBody = body;
  if (ctx.model.length > 0) {
    effectiveBody = enforceCategoryModel(body, ctx.model);
  }

  switch (ctx.format) {
    case "openai":
      return openai.translateRequest(effectiveBody);
    case "x402engine":
      return x402engine.translateRequest(ctx, effectiveBody);
    case "blockrun":
      return blockrun.translateRequest(effectiveBody);
    case "askclaude":
      return askclaude.translateRequest(ctx, effectiveBody);
    case "spraay":
      return spraay.translateRequest(effectiveBody);
    default:
      return openai.translateRequest(effectiveBody);
  }
}

/**
 * Translate a provider response body back to OpenAI format.
 */
export function translateResponse(
  ctx: TranslateContext,
  body: Buffer,
  status: number
): Buffer {
  if (
    !ctx.categoryId.startsWith("llm/") ||
    !isChatCompletionsPath(ctx.clientPath)
  ) {
    return body;
  }

  switch (ctx.format) {
    case "openai":
      return openai.translateResponse(body, status);
    case "x402engine":
      return x402engine.translateResponse(body, status);
    case "blockrun":
      return blockrun.translateResponse(body, status);
    case "askclaude":
      return askclaude.translateResponse(body, status, ctx.model);
    case "spraay":
      return spraay.translateResponse(body, status);
    default:
      return openai.translateResponse(body, status);
  }
}
