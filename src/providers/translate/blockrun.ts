import type {
  TranslatedRequest,
  ChatCompletionRequest,
} from "../../types.js";
import {
  vendorPrefix,
  stripVendorPrefix,
  hyphensToDots,
  dotsToHyphens,
} from "./vendor.js";

/** Convert canonical model name to BlockRun format with vendor prefix. */
export function toBlockrunModel(model: string): string {
  const prefixed = vendorPrefix(model);
  return hyphensToDots(prefixed);
}

/** Convert BlockRun model name back to canonical format. */
export function fromBlockrunModel(model: string): string {
  const stripped = stripVendorPrefix(model);
  // Only convert dots->hyphens for Claude models where dots were synthetic.
  if (stripped.startsWith("claude")) {
    return dotsToHyphens(stripped);
  }
  return stripped;
}

/** Translate OpenAI request -> BlockRun request. */
export function translateRequest(body: Buffer): TranslatedRequest {
  const req: ChatCompletionRequest = JSON.parse(body.toString());

  const clientWantsStream = req.stream ?? false;
  if (clientWantsStream) {
    req.stream = false;
  }

  req.model = toBlockrunModel(req.model);

  return {
    body: Buffer.from(JSON.stringify(req)),
    pathOverride: undefined,
    stripStreaming: clientWantsStream,
  };
}

/** Translate BlockRun response -> strip vendor prefix and convert dots back to hyphens. */
export function translateResponse(body: Buffer, status: number): Buffer {
  if (status < 200 || status >= 300) {
    return body;
  }

  const resp = JSON.parse(body.toString());

  if (typeof resp.model === "string") {
    resp.model = fromBlockrunModel(resp.model);
  }

  return Buffer.from(JSON.stringify(resp));
}
