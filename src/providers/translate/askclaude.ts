import type {
  TranslateContext,
  TranslatedRequest,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatUsage,
} from "../../types.js";
import { v4 as uuidv4 } from "uuid";

interface AskClaudeRequest {
  prompt: string;
  system?: string;
}

interface AskClaudeResponse {
  answer: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Map canonical model name to askclaude path segment.
 * Returns an error string for non-Claude models during request translation.
 */
function modelToPathSegment(model: string): string | Error {
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  return new Error(
    `model '${model}' is not a Claude model and cannot be routed through askclaude format`
  );
}

/** Public accessor for probe path segment. Falls back to "opus". */
export function probePathSegment(model: string): string {
  const result = modelToPathSegment(model);
  return result instanceof Error ? "opus" : result;
}

/** Extract text from message content (handles string and multimodal array). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (part: any) =>
          typeof part === "object" &&
          part !== null &&
          part.type === "text" &&
          typeof part.text === "string"
      )
      .map((part: any) => part.text)
      .join("\n");
  }
  return String(content);
}

/** Translate OpenAI request -> AskClaude request. */
export function translateRequest(
  ctx: TranslateContext,
  body: Buffer
): TranslatedRequest {
  const openaiReq: ChatCompletionRequest = JSON.parse(body.toString());

  const clientWantsStream = openaiReq.stream ?? false;

  let system: string | undefined;
  const promptParts: string[] = [];

  for (const msg of openaiReq.messages) {
    const text = extractText(msg.content);
    switch (msg.role) {
      case "system":
        system = text;
        break;
      case "user":
        promptParts.push(text);
        break;
      case "assistant":
        promptParts.push(`Assistant: ${text}`);
        break;
      default:
        promptParts.push(text);
        break;
    }
  }

  const prompt = promptParts.join("\n");
  if (prompt.length === 0) {
    throw new Error("no user message found in request");
  }

  const segment = modelToPathSegment(ctx.model);
  if (segment instanceof Error) {
    throw segment;
  }

  const askReq: AskClaudeRequest = { prompt };
  if (system !== undefined) {
    askReq.system = system;
  }

  const pathOverride = `/ask/${segment}`;

  return {
    body: Buffer.from(JSON.stringify(askReq)),
    pathOverride,
    stripStreaming: clientWantsStream,
  };
}

/** Translate AskClaude response -> OpenAI response. */
export function translateResponse(
  body: Buffer,
  status: number,
  model: string
): Buffer {
  if (status < 200 || status >= 300) {
    return body;
  }

  const askResp: AskClaudeResponse = JSON.parse(body.toString());

  const usage: ChatUsage | undefined = askResp.usage
    ? {
        prompt_tokens: askResp.usage.input_tokens,
        completion_tokens: askResp.usage.output_tokens,
        total_tokens:
          askResp.usage.input_tokens !== undefined &&
          askResp.usage.output_tokens !== undefined
            ? askResp.usage.input_tokens + askResp.usage.output_tokens
            : undefined,
      }
    : undefined;

  const respModel = askResp.model ?? model;

  const openaiResp: ChatCompletionResponse = {
    id: `chatcmpl-${uuidv4()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: respModel,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: askResp.answer,
        },
        finish_reason: "stop",
      },
    ],
    usage,
  };

  return Buffer.from(JSON.stringify(openaiResp));
}
