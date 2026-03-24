import { describe, it, expect } from "vitest";
import {
  toBlockrunModel,
  fromBlockrunModel,
  translateRequest,
  translateResponse,
} from "../blockrun.js";
import { hyphensToDots } from "../vendor.js";

describe("toBlockrunModel", () => {
  it("should convert claude models", () => {
    expect(toBlockrunModel("claude-opus-4-6")).toBe("anthropic/claude-opus-4.6");
    expect(toBlockrunModel("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4.6");
    expect(toBlockrunModel("claude-haiku-4-5")).toBe("anthropic/claude-haiku-4.5");
  });

  it("should convert openai models", () => {
    expect(toBlockrunModel("gpt-4o")).toBe("openai/gpt-4o");
    expect(toBlockrunModel("gpt-4o-mini")).toBe("openai/gpt-4o-mini");
    expect(toBlockrunModel("o3-mini")).toBe("openai/o3-mini");
  });

  it("should convert google models", () => {
    expect(toBlockrunModel("gemini-3.1-pro")).toBe("google/gemini-3.1-pro");
    expect(toBlockrunModel("gemini-3.1-flash-lite")).toBe("google/gemini-3.1-flash-lite");
  });

  it("should convert deepseek models", () => {
    expect(toBlockrunModel("deepseek-v3.2")).toBe("deepseek/deepseek-v3.2");
  });

  it("should convert xai models", () => {
    expect(toBlockrunModel("grok-4")).toBe("xai/grok-4");
  });

  it("should convert minimax models", () => {
    expect(toBlockrunModel("minimax-m2.5")).toBe("minimax/minimax-m2.5");
  });

  it("should pass through unknown models", () => {
    expect(toBlockrunModel("llama-3")).toBe("llama-3");
  });
});

describe("fromBlockrunModel", () => {
  it("should roundtrip all known models", () => {
    expect(fromBlockrunModel("anthropic/claude-opus-4.6")).toBe("claude-opus-4-6");
    expect(fromBlockrunModel("anthropic/claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    expect(fromBlockrunModel("openai/gpt-4o")).toBe("gpt-4o");
    expect(fromBlockrunModel("google/gemini-3.1-pro")).toBe("gemini-3.1-pro");
    expect(fromBlockrunModel("deepseek/deepseek-v3.2")).toBe("deepseek-v3.2");
    expect(fromBlockrunModel("xai/grok-4")).toBe("grok-4");
    expect(fromBlockrunModel("minimax/minimax-m2.5")).toBe("minimax-m2.5");
    expect(fromBlockrunModel("llama-3")).toBe("llama-3");
  });
});

describe("hyphensToDots (via vendor)", () => {
  it("should handle version conversion cases", () => {
    expect(hyphensToDots("anthropic/claude-opus-4-6")).toBe("anthropic/claude-opus-4.6");
    expect(hyphensToDots("openai/gpt-4o")).toBe("openai/gpt-4o");
    expect(hyphensToDots("google/gemini-2.5-pro")).toBe("google/gemini-2.5-pro");
  });
});

describe("translateRequest", () => {
  it("should rewrite model with dots and force buffered for streaming", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100,
      stream: true,
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.model).toBe("anthropic/claude-opus-4.6");
    expect(parsed.max_tokens).toBe(100);
    expect(parsed.stream).toBe(false);

    expect(result.pathOverride).toBeUndefined();
    expect(result.stripStreaming).toBe(true);
  });
});

describe("translateResponse", () => {
  it("should strip prefix and convert dots back", () => {
    const blockrunBody = {
      id: "chatcmpl-123",
      object: "chat.completion",
      model: "anthropic/claude-opus-4.6",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hi" },
          finish_reason: "stop",
        },
      ],
    };
    const body = Buffer.from(JSON.stringify(blockrunBody));
    const result = translateResponse(body, 200);

    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("claude-opus-4-6");
  });

  it("should passthrough error responses", () => {
    const body = Buffer.from("error");
    const result = translateResponse(body, 500);
    expect(result.toString()).toBe("error");
  });

  // Real captured payload tests

  it("should parse real claude-haiku payload", () => {
    const real = {
      id: "msg_01UsJXemPFSWRnX8xZGWitsp",
      object: "chat.completion",
      created: 1773281407,
      model: "claude-haiku-4-5-20251001",
      choices: [
        { index: 0, message: { role: "assistant", content: "Hello! \ud83d\udc4b" }, finish_reason: "length" },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    // No vendor prefix -> from_blockrun_model is a no-op
    expect(parsed.model).toBe("claude-haiku-4-5-20251001");
    expect(parsed.choices[0].message.content).toBe("Hello! \ud83d\udc4b");
  });

  it("should parse real gpt-4o-mini payload", () => {
    const real = {
      id: "chatcmpl-DIPmzhfCvNmkH4Od9UCe5yndLwQHs",
      object: "chat.completion",
      created: 1773281409,
      model: "gpt-5-mini-2025-08-07",
      choices: [
        { index: 0, message: { role: "assistant", content: "" }, finish_reason: "length" },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    // No vendor prefix -> leaves as-is
    expect(parsed.model).toBe("gpt-5-mini-2025-08-07");
  });

  it("should parse real gemini-flash payload", () => {
    const real = {
      id: "gemini-1773281413371",
      object: "chat.completion",
      created: 1773281413,
      model: "google/gemini-2.5-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hi there! How can I help you today?" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 10, total_tokens: 12 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("gemini-2.5-flash");
    expect(parsed.choices[0].message.content).toBe(
      "Hi there! How can I help you today?"
    );
  });
});
