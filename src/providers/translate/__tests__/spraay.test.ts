import { describe, it, expect } from "vitest";
import {
  toSpraayModel,
  fromSpraayModel,
  translateRequest,
  translateResponse,
} from "../spraay.js";

describe("toSpraayModel", () => {
  it("should convert claude models", () => {
    expect(toSpraayModel("claude-opus-4-6")).toBe("anthropic/claude-opus-4.6");
    expect(toSpraayModel("claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4.6");
  });

  it("should convert openai models", () => {
    expect(toSpraayModel("gpt-4o")).toBe("openai/gpt-4o");
  });

  it("should add preview suffix for gemini 3.1 models", () => {
    expect(toSpraayModel("gemini-3.1-pro")).toBe("google/gemini-3.1-pro-preview");
    expect(toSpraayModel("gemini-3.1-flash-lite")).toBe("google/gemini-3.1-flash-lite-preview");
  });

  it("should convert deepseek models", () => {
    expect(toSpraayModel("deepseek-v3.2")).toBe("deepseek/deepseek-v3.2");
  });

  it("should convert minimax models", () => {
    expect(toSpraayModel("minimax-m2.5")).toBe("minimax/minimax-m2.5");
  });
});

describe("fromSpraayModel", () => {
  it("should handle claude with date suffix", () => {
    expect(fromSpraayModel("anthropic/claude-4.6-opus-20260205")).toBe("claude-4.6-opus");
  });

  it("should handle standard claude", () => {
    expect(fromSpraayModel("anthropic/claude-opus-4.6")).toBe("claude-opus-4-6");
  });

  it("should handle openai", () => {
    expect(fromSpraayModel("openai/gpt-4o")).toBe("gpt-4o");
  });

  it("should handle gemini with preview", () => {
    expect(fromSpraayModel("google/gemini-3.1-pro-preview")).toBe("gemini-3.1-pro");
  });

  it("should handle deepseek", () => {
    expect(fromSpraayModel("deepseek/deepseek-v3.2")).toBe("deepseek-v3.2");
  });

  it("should handle minimax", () => {
    expect(fromSpraayModel("minimax/minimax-m2.5")).toBe("minimax-m2.5");
  });
});

describe("translateRequest", () => {
  it("should rewrite model and force buffered for streaming", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.model).toBe("anthropic/claude-opus-4.6");
    expect(parsed.stream).toBe(false);
    expect(result.pathOverride).toBeUndefined();
    expect(result.stripStreaming).toBe(true);
  });

  it("should not modify stream when not streaming", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "hello" }],
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.stream).toBeUndefined();
    expect(result.stripStreaming).toBe(false);
  });

  it("should add preview suffix for gemini models", () => {
    const openaiBody = {
      model: "gemini-3.1-pro",
      messages: [{ role: "user", content: "hi" }],
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.model).toBe("google/gemini-3.1-pro-preview");
  });
});

describe("translateResponse", () => {
  it("should passthrough error responses", () => {
    const body = Buffer.from("error");
    const result = translateResponse(body, 500);
    expect(result.toString()).toBe("error");
  });

  // Real captured payload tests

  it("should parse real claude-sonnet payload", () => {
    const real = {
      id: "gen-1773332472-EOPTrvZ1EJQXYNrMHzLU",
      object: "chat.completion",
      created: 1773332472,
      model: "anthropic/claude-4.6-sonnet-20260217",
      provider: "Google",
      system_fingerprint: null,
      choices: [
        {
          index: 0,
          logprobs: null,
          finish_reason: "length",
          native_finish_reason: "length",
          message: {
            role: "assistant",
            content: "Hi there! How are",
            refusal: null,
            reasoning: null,
          },
        },
      ],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 5,
        total_tokens: 13,
        cost: 0.000099,
      },
      _gateway: { provider: "spraay-x402", protocol: "x402", powered_by: "openrouter" },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("claude-4.6-sonnet");
    expect(parsed.choices[0].message.content).toBe("Hi there! How are");
    expect(parsed.provider).toBe("Google");
    expect(parsed._gateway).toBeDefined();
  });

  it("should parse real claude-opus payload", () => {
    const real = {
      id: "gen-1773332483-UHedfviCIWddcgYgmCNh",
      object: "chat.completion",
      created: 1773332483,
      model: "anthropic/claude-4.6-opus-20260205",
      provider: "Amazon Bedrock",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: { role: "assistant", content: "Hi there! How are" },
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("claude-4.6-opus");
    expect(parsed.provider).toBe("Amazon Bedrock");
  });

  it("should parse real gpt-4o payload", () => {
    const real = {
      id: "gen-1773332491-6dV4ZC6a8Tss1R6RCqYL",
      object: "chat.completion",
      created: 1773332491,
      model: "openai/gpt-4o",
      provider: "OpenAI",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: { role: "assistant", content: "Hello! How can I" },
        },
      ],
      usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("gpt-4o");
  });

  it("should parse real deepseek payload with date suffix", () => {
    const real = {
      id: "gen-1773332510-sJYWw2tW6MkDQ9My4p7l",
      object: "chat.completion",
      model: "deepseek/deepseek-v3.2-20251201",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: { role: "assistant", content: "\u4f60\u597d\uff01\ud83d\udc4b " },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("deepseek-v3.2");
  });

  it("should parse real deepseek alt name payload", () => {
    const real = {
      id: "gen-1773332495-o1vDcQ1R8ivnMwGl5Gid",
      object: "chat.completion",
      model: "deepseek/deepseek-chat-v3",
      provider: "DeepInfra",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: { role: "assistant", content: "Hello! How can I" },
        },
      ],
      usage: { prompt_tokens: 4, completion_tokens: 5, total_tokens: 9 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("deepseek-chat-v3");
  });

  it("should parse real minimax payload", () => {
    const real = {
      id: "gen-1773332497-PYlsy8BKfFDoHDS0bSfN",
      object: "chat.completion",
      model: "minimax/minimax-m2.5-20260211",
      provider: "Fireworks",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: {
            role: "assistant",
            content: null,
            reasoning: "The user has sent a",
          },
        },
      ],
      usage: { prompt_tokens: 38, completion_tokens: 5, total_tokens: 43 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("minimax-m2.5");
    expect(parsed.choices[0].message.reasoning).toBe("The user has sent a");
  });

  it("should parse real gemini-3.1-pro payload", () => {
    const real = {
      id: "gen-1773332523-Rt6idRd852fDfClyzkH7",
      object: "chat.completion",
      model: "google/gemini-3.1-pro-preview-20260219",
      provider: "Google",
      choices: [
        {
          index: 0,
          finish_reason: "length",
          message: { role: "assistant", content: "Hello" },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200);
    const parsed = JSON.parse(result.toString());
    expect(parsed.model).toBe("gemini-3.1-pro");
    expect(parsed.choices[0].message.content).toBe("Hello");
  });
});
