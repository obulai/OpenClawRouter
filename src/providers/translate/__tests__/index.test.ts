import { describe, it, expect } from "vitest";
import {
  probePathForFormat,
  enforceCategoryModel,
  translateRequest,
  translateResponse,
} from "../index.js";
import type { TranslateContext } from "../../../types.js";

describe("probePathForFormat", () => {
  it("should return x402engine path", () => {
    expect(probePathForFormat("x402engine", "claude-opus-4-6")).toBe(
      "/api/llm/claude-opus"
    );
  });

  it("should return askclaude path", () => {
    expect(probePathForFormat("askclaude", "claude-opus-4-6")).toBe(
      "/ask/opus"
    );
  });

  it("should return chat completions for openai/blockrun/spraay", () => {
    expect(probePathForFormat("openai", "gpt-4o")).toBe(
      "/v1/chat/completions"
    );
    expect(probePathForFormat("blockrun", "gpt-4o")).toBe(
      "/v1/chat/completions"
    );
    expect(probePathForFormat("spraay", "gpt-4o")).toBe(
      "/v1/chat/completions"
    );
  });

  it("should return chat completions for empty model", () => {
    expect(probePathForFormat("x402engine", "")).toBe("/v1/chat/completions");
    expect(probePathForFormat("askclaude", "")).toBe("/v1/chat/completions");
  });
});

describe("translateRequest", () => {
  it("should passthrough non-LLM categories", () => {
    const ctx: TranslateContext = {
      format: "x402engine",
      categoryId: "search/web",
      model: "",
      clientPath: "/v1/search",
    };
    const body = Buffer.from('{"query":"test"}');
    const result = translateRequest(ctx, body);
    expect(result.body).toEqual(body);
    expect(result.pathOverride).toBeUndefined();
    expect(result.stripStreaming).toBe(false);
  });

  it("should passthrough non-chat-completion paths for LLM categories", () => {
    const ctx: TranslateContext = {
      format: "askclaude",
      categoryId: "llm/claude-opus-4-6",
      model: "claude-opus-4-6",
      clientPath: "/v1/models",
    };
    const body = Buffer.from('{"not":"a chat request"}');
    const result = translateRequest(ctx, body);
    expect(result.body).toEqual(body);
    expect(result.pathOverride).toBeUndefined();
    expect(result.stripStreaming).toBe(false);
  });

  it("should dispatch OpenAI format", () => {
    const ctx: TranslateContext = {
      format: "openai",
      categoryId: "llm/gpt-4o",
      model: "gpt-4o",
      clientPath: "/v1/chat/completions",
    };
    const body = Buffer.from(
      '{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}'
    );
    const result = translateRequest(ctx, body);
    const resultJson = JSON.parse(result.body.toString());
    const expected = JSON.parse(body.toString());
    expect(resultJson).toEqual(expected);
    expect(result.pathOverride).toBeUndefined();
  });

  it("should enforce category model over client model", () => {
    const ctx: TranslateContext = {
      format: "openai",
      categoryId: "llm/gpt-4o",
      model: "gpt-4o",
      clientPath: "/v1/chat/completions",
    };
    const body = Buffer.from(
      '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"hi"}]}'
    );
    const result = translateRequest(ctx, body);
    const parsed = JSON.parse(result.body.toString());
    expect(parsed.model).toBe("gpt-4o");
  });

  it("should dispatch x402engine format", () => {
    const ctx: TranslateContext = {
      format: "x402engine",
      categoryId: "llm/claude-opus-4-6",
      model: "claude-opus-4-6",
      clientPath: "/v1/chat/completions",
    };
    const body = Buffer.from(
      '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"hi"}]}'
    );
    const result = translateRequest(ctx, body);
    expect(result.pathOverride).toBe("/api/llm/claude-opus");
  });

  it("should dispatch blockrun format", () => {
    const ctx: TranslateContext = {
      format: "blockrun",
      categoryId: "llm/claude-opus-4-6",
      model: "claude-opus-4-6",
      clientPath: "/v1/chat/completions",
    };
    const body = Buffer.from(
      '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"hi"}]}'
    );
    const result = translateRequest(ctx, body);
    const parsed = JSON.parse(result.body.toString());
    expect(parsed.model).toBe("anthropic/claude-opus-4.6");
  });

  it("should dispatch askclaude format", () => {
    const ctx: TranslateContext = {
      format: "askclaude",
      categoryId: "llm/claude-opus-4-6",
      model: "claude-opus-4-6",
      clientPath: "/v1/chat/completions",
    };
    const body = Buffer.from(
      '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"hi"}]}'
    );
    const result = translateRequest(ctx, body);
    expect(result.pathOverride).toBe("/ask/opus");
    const parsed = JSON.parse(result.body.toString());
    expect(parsed.prompt).toBe("hi");
  });
});

describe("translateResponse", () => {
  it("should passthrough non-LLM categories", () => {
    const ctx: TranslateContext = {
      format: "x402engine",
      categoryId: "image/generate",
      model: "",
      clientPath: "/v1/images",
    };
    const body = Buffer.from('{"url":"https://example.com/image.png"}');
    const result = translateResponse(ctx, body, 200);
    expect(result).toEqual(body);
  });
});
