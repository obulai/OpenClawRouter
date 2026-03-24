import { describe, it, expect } from 'vitest';
import { selectModelForTier, selectModelWithFallback } from '../selector.js';

describe('selectModelForTier', () => {
  it('maps auto profile tiers correctly', () => {
    expect(selectModelForTier('simple', 'auto')).toBe('gemini-3.1-flash-lite');
    expect(selectModelForTier('medium', 'auto')).toBe('claude-sonnet-4-6');
    expect(selectModelForTier('complex', 'auto')).toBe('claude-opus-4-6');
    expect(selectModelForTier('reasoning', 'auto')).toBe('claude-opus-4-6');
  });

  it('maps eco profile tiers correctly', () => {
    expect(selectModelForTier('simple', 'eco')).toBe('gemini-3.1-flash-lite');
    expect(selectModelForTier('medium', 'eco')).toBe('deepseek-v3.2');
    expect(selectModelForTier('complex', 'eco')).toBe('claude-sonnet-4-6');
    expect(selectModelForTier('reasoning', 'eco')).toBe('claude-sonnet-4-6');
  });

  it('maps premium profile tiers correctly', () => {
    expect(selectModelForTier('simple', 'premium')).toBe('claude-sonnet-4-6');
    expect(selectModelForTier('medium', 'premium')).toBe('claude-opus-4-6');
    expect(selectModelForTier('complex', 'premium')).toBe('gpt-5');
    expect(selectModelForTier('reasoning', 'premium')).toBe('claude-opus-4-6');
  });

  it('maps agentic profile tiers correctly', () => {
    expect(selectModelForTier('simple', 'agentic')).toBe('claude-sonnet-4-6');
    expect(selectModelForTier('medium', 'agentic')).toBe('claude-sonnet-4-6');
    expect(selectModelForTier('complex', 'agentic')).toBe('claude-opus-4-6');
    expect(selectModelForTier('reasoning', 'agentic')).toBe('claude-opus-4-6');
  });
});

describe('selectModelWithFallback', () => {
  it('returns primary model when available', () => {
    const result = selectModelWithFallback('simple', 'auto', [
      'gemini-3.1-flash-lite',
      'claude-sonnet-4-6',
    ]);
    expect(result).toBe('gemini-3.1-flash-lite');
  });

  it('falls back to another tier model when primary is unavailable', () => {
    const result = selectModelWithFallback('simple', 'auto', [
      'claude-sonnet-4-6',
      'claude-opus-4-6',
    ]);
    // gemini-3.1-flash-lite not available, should pick from remaining tiers
    expect(['claude-sonnet-4-6', 'claude-opus-4-6']).toContain(result);
  });

  it('returns first available model as last resort', () => {
    const result = selectModelWithFallback('simple', 'auto', ['some-random-model']);
    expect(result).toBe('some-random-model');
  });

  it('returns primary model when nothing is available', () => {
    const result = selectModelWithFallback('simple', 'auto', []);
    expect(result).toBe('gemini-3.1-flash-lite');
  });
});
