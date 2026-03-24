import { describe, it, expect } from 'vitest';
import { ResponseCache } from '../response.js';
import type { CachedResponse } from '../response.js';

function makeCachedResponse(overrides: Partial<CachedResponse> = {}): CachedResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ result: 'ok' })),
    providerId: 'provider-1',
    cachedAt: Date.now(),
    ...overrides,
  };
}

describe('ResponseCache', () => {
  describe('buildKey', () => {
    it('returns a key with model prefix and SHA-256 hash', () => {
      const body = Buffer.from('test body');
      const key = ResponseCache.buildKey('gpt-4', body);
      expect(key).toMatch(/^gpt-4::[a-f0-9]{64}$/);
    });

    it('produces different keys for different models with the same body', () => {
      const body = Buffer.from('same body');
      const key1 = ResponseCache.buildKey('gpt-4', body);
      const key2 = ResponseCache.buildKey('claude-3', body);
      expect(key1).not.toBe(key2);
    });

    it('produces different keys for the same model with different bodies', () => {
      const key1 = ResponseCache.buildKey('gpt-4', Buffer.from('body A'));
      const key2 = ResponseCache.buildKey('gpt-4', Buffer.from('body B'));
      expect(key1).not.toBe(key2);
    });

    it('produces the same key for identical model and body', () => {
      const body = Buffer.from('identical');
      const key1 = ResponseCache.buildKey('gpt-4', body);
      const key2 = ResponseCache.buildKey('gpt-4', body);
      expect(key1).toBe(key2);
    });
  });

  describe('get / set', () => {
    it('returns undefined for unknown keys', () => {
      const cache = new ResponseCache();
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('stores and retrieves a cached response', () => {
      const cache = new ResponseCache();
      const entry = makeCachedResponse();
      cache.set('key1', entry);
      expect(cache.get('key1')).toBe(entry);
    });

    it('overwrites an existing entry for the same key', () => {
      const cache = new ResponseCache();
      const entry1 = makeCachedResponse({ providerId: 'old' });
      const entry2 = makeCachedResponse({ providerId: 'new' });
      cache.set('key', entry1);
      cache.set('key', entry2);
      expect(cache.get('key')?.providerId).toBe('new');
    });

    it('stores multiple entries independently', () => {
      const cache = new ResponseCache();
      const e1 = makeCachedResponse({ providerId: 'p1' });
      const e2 = makeCachedResponse({ providerId: 'p2' });
      cache.set('k1', e1);
      cache.set('k2', e2);
      expect(cache.get('k1')?.providerId).toBe('p1');
      expect(cache.get('k2')?.providerId).toBe('p2');
    });
  });

  describe('size', () => {
    it('returns 0 for empty cache', () => {
      const cache = new ResponseCache();
      expect(cache.size).toBe(0);
    });

    it('reflects the number of entries', () => {
      const cache = new ResponseCache();
      cache.set('a', makeCachedResponse());
      cache.set('b', makeCachedResponse());
      expect(cache.size).toBe(2);
    });
  });

  describe('max entries', () => {
    it('evicts oldest entries when capacity is exceeded', () => {
      const cache = new ResponseCache(600_000, 2); // max 2 entries
      cache.set('first', makeCachedResponse({ providerId: 'first' }));
      cache.set('second', makeCachedResponse({ providerId: 'second' }));
      cache.set('third', makeCachedResponse({ providerId: 'third' }));

      expect(cache.size).toBe(2);
      expect(cache.get('first')).toBeUndefined();
      expect(cache.get('third')?.providerId).toBe('third');
    });
  });

  describe('TTL', () => {
    it('returns undefined for entries that have expired', async () => {
      const cache = new ResponseCache(50, 100); // 50ms TTL
      cache.set('key', makeCachedResponse());

      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 100));

      expect(cache.get('key')).toBeUndefined();
    });
  });

  describe('preserves response data', () => {
    it('preserves status, headers, body, and providerId', () => {
      const cache = new ResponseCache();
      const entry = makeCachedResponse({
        status: 201,
        headers: { 'x-custom': 'value' },
        body: Buffer.from('custom body'),
        providerId: 'special-provider',
      });

      cache.set('key', entry);
      const retrieved = cache.get('key')!;

      expect(retrieved.status).toBe(201);
      expect(retrieved.headers['x-custom']).toBe('value');
      expect(retrieved.body.toString()).toBe('custom body');
      expect(retrieved.providerId).toBe('special-provider');
    });
  });
});
