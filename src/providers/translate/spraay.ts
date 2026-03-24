import type {
  TranslatedRequest,
  ChatCompletionRequest,
} from "../../types.js";
import { vendorPrefix, hyphensToDots, normalizeUpstreamModel } from "./vendor.js";

/** Model-specific overrides applied before vendor prefixing. */
function spraayModelOverride(model: string): string {
  switch (model) {
    case "gemini-3.1-pro":
      return "gemini-3.1-pro-preview";
    case "gemini-3.1-flash-lite":
      return "gemini-3.1-flash-lite-preview";
    default:
      return model;
  }
}

/** Convert canonical model name to Spraay format with vendor prefix. */
export function toSpraayModel(model: string): string {
  const overridden = spraayModelOverride(model);
  const prefixed = vendorPrefix(overridden);
  return hyphensToDots(prefixed);
}

/** Convert Spraay model name back to canonical format. */
export function fromSpraayModel(model: string): string {
  return normalizeUpstreamModel(model);
}

/** Translate OpenAI request -> Spraay request. */
export function translateRequest(body: Buffer): TranslatedRequest {
  const req: ChatCompletionRequest = JSON.parse(body.toString());

  const clientWantsStream = req.stream ?? false;
  if (clientWantsStream) {
    req.stream = false;
  }

  req.model = toSpraayModel(req.model);

  return {
    body: Buffer.from(JSON.stringify(req)),
    pathOverride: undefined,
    stripStreaming: clientWantsStream,
  };
}

/** Translate Spraay response -> canonical format. */
export function translateResponse(body: Buffer, status: number): Buffer {
  if (status < 200 || status >= 300) {
    return body;
  }

  const resp = JSON.parse(body.toString());

  if (typeof resp.model === "string") {
    resp.model = fromSpraayModel(resp.model);
  }

  return Buffer.from(JSON.stringify(resp));
}
