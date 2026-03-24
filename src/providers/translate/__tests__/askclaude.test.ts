import { describe, it, expect } from "vitest";
import {
  probePathSegment,
  translateRequest,
  translateResponse,
} from "../askclaude.js";
import type { TranslateContext } from "../../../types.js";

function ctx(model: string): TranslateContext {
  return {
    format: "askclaude",
    categoryId: "llm/claude-opus-4-6",
    model,
    clientPath: "/v1/chat/completions",
  };
}

describe("probePathSegment", () => {
  it("should return correct segments for Claude models", () => {
    expect(probePathSegment("claude-opus-4-6")).toBe("opus");
    expect(probePathSegment("claude-sonnet-4-6")).toBe("sonnet");
    expect(probePathSegment("claude-haiku-4-5")).toBe("haiku");
  });

  it("should fallback to opus for unknown models", () => {
    expect(probePathSegment("gpt-4o")).toBe("opus");
  });
});

describe("translateRequest", () => {
  it("should convert messages to prompt", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "What is rust?" },
      ],
      max_tokens: 100,
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(ctx("claude-opus-4-6"), body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.prompt).toBe("What is rust?");
    expect(parsed.system).toBe("You are helpful.");
    expect(parsed.model).toBeUndefined();
    expect(parsed.messages).toBeUndefined();

    expect(result.pathOverride).toBe("/ask/opus");
    expect(result.stripStreaming).toBe(false);
  });

  it("should set stripStreaming when client wants stream", () => {
    const openaiBody = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(ctx("claude-sonnet-4-6"), body);

    expect(result.pathOverride).toBe("/ask/sonnet");
    expect(result.stripStreaming).toBe(true);
  });

  it("should route haiku model correctly", () => {
    const openaiBody = {
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "hi" }],
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(ctx("claude-haiku-4-5"), body);

    expect(result.pathOverride).toBe("/ask/haiku");
  });

  it("should concatenate multi-turn messages", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [
        { role: "user", content: "hello" },
        { role: "assistant", content: "Hi there!" },
        { role: "user", content: "how are you?" },
      ],
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(ctx("claude-opus-4-6"), body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.prompt).toBe("hello\nAssistant: Hi there!\nhow are you?");
  });

  it("should error on empty messages", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [{ role: "system", content: "system only" }],
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    expect(() => translateRequest(ctx("claude-opus-4-6"), body)).toThrow();
  });

  it("should reject non-Claude model", () => {
    const openaiBody = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    expect(() => translateRequest(ctx("gpt-4o"), body)).toThrow(
      "not a Claude model"
    );
  });

  it("should extract text from multimodal content", () => {
    const openaiBody = {
      model: "claude-opus-4-6",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image?" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,abc" },
            },
          ],
        },
      ],
    };
    const body = Buffer.from(JSON.stringify(openaiBody));
    const result = translateRequest(ctx("claude-opus-4-6"), body);

    const parsed = JSON.parse(result.body.toString());
    expect(parsed.prompt).toBe("What is in this image?");
  });
});

describe("translateResponse", () => {
  it("should convert to OpenAI format", () => {
    const askBody = {
      answer: "Rust is a systems programming language.",
      model: "claude-opus-4-6",
      usage: {
        input_tokens: 15,
        output_tokens: 8,
      },
    };
    const body = Buffer.from(JSON.stringify(askBody));
    const result = translateResponse(body, 200, "claude-opus-4-6");

    const parsed = JSON.parse(result.toString());
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.choices.length).toBe(1);
    expect(parsed.choices[0].message.content).toBe(
      "Rust is a systems programming language."
    );
    expect(parsed.usage.prompt_tokens).toBe(15);
    expect(parsed.usage.completion_tokens).toBe(8);
    expect(parsed.usage.total_tokens).toBe(23);
  });

  it("should passthrough error responses", () => {
    const body = Buffer.from("not found");
    const result = translateResponse(body, 404, "claude-opus-4-6");
    expect(result.toString()).toBe("not found");
  });

  // Real captured payload tests

  it("should parse real haiku payload", () => {
    const real = {
      answer: "Hi! How can I help you today?",
      model: "claude-haiku-4-5-20251001",
      usage: { input_tokens: 21, output_tokens: 12 },
    };
    const body = Buffer.from(JSON.stringify(real));
    const result = translateResponse(body, 200, "claude-haiku-4-5");

    const parsed = JSON.parse(result.toString());
    expect(parsed.object).toBe("chat.completion");
    expect(parsed.model).toBe("claude-haiku-4-5-20251001");
    expect(parsed.choices[0].message.content).toBe(
      "Hi! How can I help you today?"
    );
    expect(parsed.usage.prompt_tokens).toBe(21);
    expect(parsed.usage.completion_tokens).toBe(12);
    expect(parsed.usage.total_tokens).toBe(33);
  });
});
