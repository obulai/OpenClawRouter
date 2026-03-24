import { describe, it, expect } from "vitest";
import {
  vendorPrefix,
  stripVendorPrefix,
  hyphensToDots,
  dotsToHyphens,
  stripDateSuffix,
  normalizeUpstreamModel,
} from "../vendor.js";

describe("vendorPrefix", () => {
  it("should add vendor prefix to known models", () => {
    expect(vendorPrefix("claude-opus-4-6")).toBe("anthropic/claude-opus-4-6");
    expect(vendorPrefix("gpt-4o")).toBe("openai/gpt-4o");
    expect(vendorPrefix("gemini-3.1-pro")).toBe("google/gemini-3.1-pro");
    expect(vendorPrefix("deepseek-v3.2")).toBe("deepseek/deepseek-v3.2");
    expect(vendorPrefix("grok-4")).toBe("xai/grok-4");
    expect(vendorPrefix("minimax-m2.5")).toBe("minimax/minimax-m2.5");
    expect(vendorPrefix("llama-3")).toBe("llama-3");
  });
});

describe("stripVendorPrefix", () => {
  it("should strip known vendor prefixes", () => {
    expect(stripVendorPrefix("anthropic/claude-opus-4.6")).toBe(
      "claude-opus-4.6"
    );
    expect(stripVendorPrefix("openai/gpt-4o")).toBe("gpt-4o");
    expect(stripVendorPrefix("google/gemini-3.1-pro")).toBe("gemini-3.1-pro");
    expect(stripVendorPrefix("llama-3")).toBe("llama-3");
  });
});

describe("hyphensToDots", () => {
  it("should convert trailing version hyphens to dots", () => {
    expect(hyphensToDots("anthropic/claude-opus-4-6")).toBe(
      "anthropic/claude-opus-4.6"
    );
    expect(hyphensToDots("openai/gpt-4o")).toBe("openai/gpt-4o");
    expect(hyphensToDots("google/gemini-2.5-pro")).toBe(
      "google/gemini-2.5-pro"
    );
  });
});

describe("stripDateSuffix", () => {
  it("should strip 8-digit date suffixes", () => {
    expect(stripDateSuffix("claude-4.6-opus-20260205")).toBe("claude-4.6-opus");
    expect(stripDateSuffix("gpt-4o-20260217")).toBe("gpt-4o");
    expect(stripDateSuffix("gpt-4o")).toBe("gpt-4o");
    expect(stripDateSuffix("short")).toBe("short");
  });

  it("should handle non-ASCII safely", () => {
    const allMb = "\u4f60\u597d\u4e16\u754c\u6a21\u578b";
    expect(stripDateSuffix(allMb)).toBe(allMb);
  });
});

describe("normalizeUpstreamModel", () => {
  it("should normalize Claude models", () => {
    // Claude: strip vendor, date, convert dots->hyphens
    expect(normalizeUpstreamModel("anthropic/claude-4.6-opus-20260205")).toBe(
      "claude-4.6-opus"
    );
    expect(normalizeUpstreamModel("anthropic/claude-opus-4.6")).toBe(
      "claude-opus-4-6"
    );
  });

  it("should normalize OpenAI models", () => {
    expect(normalizeUpstreamModel("openai/gpt-4o")).toBe("gpt-4o");
  });

  it("should normalize Gemini models with date and preview", () => {
    expect(
      normalizeUpstreamModel("google/gemini-3.1-pro-preview-20260219")
    ).toBe("gemini-3.1-pro");
  });

  it("should normalize DeepSeek models", () => {
    expect(normalizeUpstreamModel("deepseek/deepseek-v3.2-20251201")).toBe(
      "deepseek-v3.2"
    );
  });

  it("should normalize MiniMax models", () => {
    expect(normalizeUpstreamModel("minimax/minimax-m2.5-20260211")).toBe(
      "minimax-m2.5"
    );
  });

  it("should normalize xAI models with x-ai/ prefix", () => {
    expect(normalizeUpstreamModel("x-ai/grok-4-07-09")).toBe("grok-4-07-09");
  });
});

describe("dotsToHyphens", () => {
  it("should convert trailing version dots to hyphens", () => {
    expect(dotsToHyphens("claude-opus-4.6")).toBe("claude-opus-4-6");
    expect(dotsToHyphens("gpt-4o")).toBe("gpt-4o");
    expect(dotsToHyphens("gemini-3.1-pro")).toBe("gemini-3.1-pro");
  });
});
