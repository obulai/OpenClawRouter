import { describe, it, expect } from 'vitest';
import { sortProvidersByPrice } from '../pricing.js';
import type { ProviderConfig } from '../../types.js';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test',
    name: 'Test',
    scheme: 'https',
    host: 'api.test.com',
    path_prefix: '',
    api_format: 'openai',
    priority: 1,
    enabled: true,
    dynamic_pricing: false,
    headers: {},
    ...overrides,
  };
}

describe('sortProvidersByPrice', () => {
  it('should sort providers cheapest first', () => {
    const providers = [
      makeProvider({ id: 'expensive', priority: 1 }),
      makeProvider({ id: 'cheap', priority: 2 }),
      makeProvider({ id: 'mid', priority: 3 }),
    ];
    const prices = new Map<string, number | null>([
      ['expensive', 100],
      ['cheap', 10],
      ['mid', 50],
    ]);

    const sorted = sortProvidersByPrice(providers, prices);
    expect(sorted.map((p) => p.id)).toEqual(['cheap', 'mid', 'expensive']);
  });

  it('should use priority as tiebreaker when prices are equal', () => {
    const providers = [
      makeProvider({ id: 'low-pri', priority: 5 }),
      makeProvider({ id: 'high-pri', priority: 1 }),
    ];
    const prices = new Map<string, number | null>([
      ['low-pri', 50],
      ['high-pri', 50],
    ]);

    const sorted = sortProvidersByPrice(providers, prices);
    expect(sorted.map((p) => p.id)).toEqual(['high-pri', 'low-pri']);
  });

  it('should put providers without prices last', () => {
    const providers = [
      makeProvider({ id: 'no-price', priority: 1 }),
      makeProvider({ id: 'has-price', priority: 2 }),
    ];
    const prices = new Map<string, number | null>([
      ['no-price', null],
      ['has-price', 50],
    ]);

    const sorted = sortProvidersByPrice(providers, prices);
    expect(sorted.map((p) => p.id)).toEqual(['has-price', 'no-price']);
  });

  it('should sort priceless providers by priority', () => {
    const providers = [
      makeProvider({ id: 'low-pri', priority: 5 }),
      makeProvider({ id: 'high-pri', priority: 1 }),
    ];
    const prices = new Map<string, number | null>([
      ['low-pri', null],
      ['high-pri', null],
    ]);

    const sorted = sortProvidersByPrice(providers, prices);
    expect(sorted.map((p) => p.id)).toEqual(['high-pri', 'low-pri']);
  });

  it('should handle missing entries in prices map', () => {
    const providers = [
      makeProvider({ id: 'missing', priority: 1 }),
      makeProvider({ id: 'has-price', priority: 2 }),
    ];
    const prices = new Map<string, number | null>([['has-price', 50]]);

    const sorted = sortProvidersByPrice(providers, prices);
    expect(sorted.map((p) => p.id)).toEqual(['has-price', 'missing']);
  });

  it('should not mutate the original array', () => {
    const providers = [
      makeProvider({ id: 'b', priority: 2 }),
      makeProvider({ id: 'a', priority: 1 }),
    ];
    const prices = new Map<string, number | null>([
      ['b', 100],
      ['a', 10],
    ]);

    sortProvidersByPrice(providers, prices);
    expect(providers[0].id).toBe('b'); // original unchanged
  });
});
