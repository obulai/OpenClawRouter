import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { DedupCache } from '../dedup.js';
import type { ProviderResponse } from '../../types.js';

function makeResponse(status: number = 200): ProviderResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ ok: true })),
  };
}

describe('DedupCache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildKey', () => {
    it('returns a hex SHA-256 hash of the body', () => {
      const body = Buffer.from('hello world');
      const key = DedupCache.buildKey(body);
      expect(key).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns the same key for identical bodies', () => {
      const body1 = Buffer.from('identical content');
      const body2 = Buffer.from('identical content');
      expect(DedupCache.buildKey(body1)).toBe(DedupCache.buildKey(body2));
    });

    it('returns different keys for different bodies', () => {
      const key1 = DedupCache.buildKey(Buffer.from('body A'));
      const key2 = DedupCache.buildKey(Buffer.from('body B'));
      expect(key1).not.toBe(key2);
    });
  });

  describe('get / set', () => {
    it('returns undefined for unknown keys', () => {
      const cache = new DedupCache();
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('returns the stored promise for a known key', () => {
      const cache = new DedupCache();
      const promise = Promise.resolve(makeResponse());
      cache.set('key1', promise);
      expect(cache.get('key1')).toBe(promise);
    });

    it('deduplicates identical keys returning the same promise', () => {
      const cache = new DedupCache();
      const promise = Promise.resolve(makeResponse());
      cache.set('dup', promise);
      expect(cache.get('dup')).toBe(cache.get('dup'));
    });

    it('allows different keys independently', () => {
      const cache = new DedupCache();
      const p1 = Promise.resolve(makeResponse(200));
      const p2 = Promise.resolve(makeResponse(201));
      cache.set('a', p1);
      cache.set('b', p2);
      expect(cache.get('a')).toBe(p1);
      expect(cache.get('b')).toBe(p2);
    });
  });

  describe('TTL expiration', () => {
    it('returns undefined for entries past the TTL', () => {
      const cache = new DedupCache(100); // 100ms TTL
      const promise = new Promise<ProviderResponse>(() => {}); // never resolves
      cache.set('key', promise);

      // Advance time past TTL
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200);

      expect(cache.get('key')).toBeUndefined();
    });

    it('returns the promise within the TTL window', () => {
      const cache = new DedupCache(5000);
      const promise = new Promise<ProviderResponse>(() => {});
      cache.set('key', promise);

      // Still within TTL
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);

      expect(cache.get('key')).toBe(promise);
    });
  });

  describe('auto-cleanup on promise settlement', () => {
    it('removes entry when promise resolves', async () => {
      const cache = new DedupCache();
      let resolve!: (val: ProviderResponse) => void;
      const promise = new Promise<ProviderResponse>((r) => { resolve = r; });

      cache.set('resolving', promise);
      expect(cache.size).toBe(1);

      resolve(makeResponse());
      await promise;
      // Allow microtask (.finally) to run
      await new Promise((r) => setTimeout(r, 0));

      expect(cache.size).toBe(0);
    });

    it('removes entry when promise rejects', async () => {
      const cache = new DedupCache();
      let reject!: (err: Error) => void;
      const promise = new Promise<ProviderResponse>((_, r) => { reject = r; });
      // Attach catch handler before rejection to avoid unhandled rejection
      const caught = promise.catch(() => {});

      cache.set('rejecting', promise);
      expect(cache.size).toBe(1);

      reject(new Error('fail'));
      await caught;
      await new Promise((r) => setTimeout(r, 10));

      expect(cache.size).toBe(0);
    });

    it('does not remove entry if it was replaced by a newer promise', async () => {
      const cache = new DedupCache();
      let resolve1!: (val: ProviderResponse) => void;
      const promise1 = new Promise<ProviderResponse>((r) => { resolve1 = r; });
      const promise2 = new Promise<ProviderResponse>(() => {});

      cache.set('key', promise1);
      // Replace with a new promise before the first resolves
      cache.set('key', promise2);

      resolve1(makeResponse());
      await promise1;
      await new Promise((r) => setTimeout(r, 0));

      // Should still have the newer entry
      expect(cache.size).toBe(1);
      expect(cache.get('key')).toBe(promise2);
    });
  });

  describe('size', () => {
    it('returns 0 for empty cache', () => {
      const cache = new DedupCache();
      expect(cache.size).toBe(0);
    });

    it('reflects the number of inflight entries', () => {
      const cache = new DedupCache();
      cache.set('a', new Promise(() => {}));
      cache.set('b', new Promise(() => {}));
      expect(cache.size).toBe(2);
    });
  });

  describe('max entries', () => {
    it('evicts oldest entries when capacity is exceeded', () => {
      const cache = new DedupCache(30_000, 2);
      cache.set('first', new Promise(() => {}));
      cache.set('second', new Promise(() => {}));
      cache.set('third', new Promise(() => {}));

      // LRU should have evicted the first entry
      expect(cache.size).toBe(2);
      expect(cache.get('first')).toBeUndefined();
      expect(cache.get('third')).toBeDefined();
    });
  });
});
