import { describe, it, expect } from "vitest";
import { engineSlug, translateRequest, translateResponse } from "../x402engine.js";
import type { TranslateContext } from "../../../types.js";

function ctx(): TranslateContext {
  return {
    format: "x402engine",
    categoryId: "llm/claude-opus-4-6",
    model: "claude-opus-4-6",
    clientPath: "/v1/chat/completions",
  };
}

describe("engineSlug", () => {
  it("should map known models to slugs", () => {
    // Anthropic
    expect(engineSlug("claude-opus-4-6")).toBe("claude-opus");
    expect(engineSlug("claude-sonnet-4-6")).toBe("claude-sonnet-4.6");
    expect(engineSlug("claude-haiku-4-5")).toBe("claude-haiku");
    // OpenAI
    expect(engineSlug("gpt-4o")).toBe("gpt-4o");
    expect(engineSlug("gpt-5")).toBe("gpt-5");
    // Google
    expect(engineSlug("gemini-3.1-pro")).toBe("gemini-3.1-pro");
    expect(engineSlug("gemini-3.1-flash-lite")).toBe("gemini-3.1-flash-lite");
    // DeepSeek
    expect(engineSlug("deepseek-v3.2")).toBe("deepseek-v3.2");
    // xAI
    expect(engineSlug("grok-4")).toBe("grok");
    // MiniMax
    expect(engineSlug("minimax-m2.5")).toBe("minimax");
    expect(engineSlug("minimax-m2.7")).toBe("minimax");
    // Unknown
    expect(engineSlug("llama-3")).toBe("llama-3");
  });
});

describe("translateRequest", () => {
  it("should strip model, stream, and extras", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100,
      stream: true,
      temperature: 0.7,
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(ctx(), body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.model).toBeUndefined();
    expect(parsed.stream).toBeUndefined();
    expect(parsed.temperature).toBeUndefined();
    expect(parsed.max_tokens).toBe(100);
    expect(parsed.messages[0].role).toBe("user");

    expect(result.pathOverride).toBe("/api/llm/claude-opus");
    expect(result.stripStreaming).toBe(true);
  });

  it("should not strip streaming when not requested", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 50,
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(ctx(), body);
    expect(result.stripStreaming).toBe(false);
  });
});

describe("translateResponse", () => {
  it("should convert to OpenAI format", () => {
    const engineBody = {
      content: "Hello! How can I help?",
      model: "claude-opus-4-6",
      usage: {
        prompt_tokens: 10,
        completion_tokens: 6,
        total_tokens: 16,
      },
    };
    const body = Buffer.from(JSON.stringify(engineBody));
    const result = translateResponse(body, 200);

    const parsed = JSON.parse(result.toString());
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.choices.length).toBe(1);
    expect(parsed.choices[0].message.content).toBe("Hello! How can I help?");
    expect(parsed.choices[0].finish_reason).toBe("stop");
    expect(parsed.usage.total_tokens).toBe(16);
  });

  it("should passthrough error responses", () => {
    const body = Buffer.from("upstream error");
    const result = translateResponse(body, 400);
    expect(result.toString()).toBe("upstream error");
  });

  // Real captured payload tests

  it("should parse real claude-opus payload", () => {
    const real = {
      content: "Hi there! How are",
      model: "anthropic/claude-4.6-opus-20260205",
      usage: {
        prompt_tokens: 8,
        completion_tokens: 5,
        total_tokens: 13,
        cost: 0.000165,
        is_byok: false,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0, audio_tokens: 0, video_tokens: 0 },
        cost_details: { upstream_inference_cost: 0.000165, upstream_inference_prompt_cost: 0.00004, upstream_inference_completions_cost: 0.000125 },
        completion_tokens_details: { reasoning_tokens: 0, image_tokens: 0, audio_tokens: 0 },
      },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.model).toBe("claude-4.6-opus");
    expect(parsed.choices[0].message.content).toBe("Hi there! How are");
    expect(parsed.usage.prompt_tokens).toBe(8);
    expect(parsed.usage.completion_tokens).toBe(5);
    expect(parsed.usage.total_tokens).toBe(13);
  });

  it("should parse real claude-sonnet payload", () => {
    const real = {
      content: "Hi there! How are",
      model: "anthropic/claude-4.6-sonnet-20260217",
      usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("claude-4.6-sonnet");
    expect(parsed.usage.total_tokens).toBe(13);
  });

  it("should parse real gpt-4o payload", () => {
    const real = {
      content: "Hello! How can I",
      model: "openai/gpt-4o",
      usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("gpt-4o");
  });

  it("should parse real gemini-2.5-pro payload", () => {
    const real = {
      content: "Hello",
      model: "google/gemini-2.5-pro",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("gemini-2.5-pro");
  });

  it("should parse real minimax payload", () => {
    const real = {
      content: "",
      model: "minimax/minimax-m2.5-20260211",
      usage: { prompt_tokens: 39, completion_tokens: 5, total_tokens: 44 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("minimax-m2.5");
    expect(parsed.choices[0].message.content).toBe("");
    expect(parsed.usage.prompt_tokens).toBe(39);
    expect(parsed.usage.completion_tokens).toBe(5);
  });

  it("should parse real deepseek payload", () => {
    const real = {
      content: "\u4f60\u597d\uff01\ud83d\udc4b ",
      model: "deepseek/deepseek-v3.2-20251201",
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("deepseek-v3.2");
    expect(parsed.choices[0].message.content).toBe("\u4f60\u597d\uff01\ud83d\udc4b ");
  });

  it("should parse real grok payload", () => {
    const real = {
      content: "Hi! How can I",
      model: "x-ai/grok-4-07-09",
      usage: { prompt_tokens: 685, completion_tokens: 134, total_tokens: 819 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("grok-4-07-09");
    expect(parsed.usage.prompt_tokens).toBe(685);
  });

  it("should parse real gemini-3.1-pro payload", () => {
    const real = {
      content: "Hello",
      model: "google/gemini-3.1-pro-preview-20260219",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("gemini-3.1-pro");
  });

  it("should parse real gemini-3.1-flash-lite payload", () => {
    const real = {
      content: "Hello",
      model: "google/gemini-3.1-flash-lite-preview-20260303",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("gemini-3.1-flash-lite");
  });
});
