import type { TranslatedRequest } from "../../types.js";

/** OpenAI format is the canonical format -- pure passthrough. */
export function translateRequest(body: Buffer): TranslatedRequest {
  return {
    body,
    pathOverride: undefined,
    stripStreaming: false,
  };
}

export function translateResponse(body: Buffer, _status: number): Buffer {
  return body;
}
