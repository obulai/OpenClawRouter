import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type { ProviderResponse } from '../types.js';

const DEFAULT_TTL_MS = 30_000; // 30 seconds
const DEFAULT_MAX_ENTRIES = 1000;

interface InflightEntry {
  promise: Promise<ProviderResponse>;
  createdAt: number;
}

/**
 * Request deduplication cache.
 *
 * Identical requests (same SHA-256 of body) arriving within the TTL window
 * share a single upstream call. This prevents duplicate charges when agents
 * retry rapidly or send parallel identical requests.
 */
export class DedupCache {
  private inflight: LRUCache<string, InflightEntry>;
  private ttlMs: number;

  constructor(ttlMs: number = DEFAULT_TTL_MS, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.inflight = new LRUCache<string, InflightEntry>({
      max: maxEntries,
      ttl: ttlMs,
    });
  }

  /**
   * Build a dedup key from the raw request body.
   * Uses SHA-256 so we don't store large bodies as keys.
   */
  static buildKey(body: Buffer): string {
    return createHash('sha256').update(body).digest('hex');
  }

  /**
   * Check if an identical request is already in flight.
   * Returns the existing promise if so, undefined otherwise.
   */
  get(key: string): Promise<ProviderResponse> | undefined {
    const entry = this.inflight.get(key);
    if (!entry) return undefined;

    // Check staleness manually (LRU TTL handles eviction, but be safe)
    if (Date.now() - entry.createdAt > this.ttlMs) {
      this.inflight.delete(key);
      return undefined;
    }

    return entry.promise;
  }

  /**
   * Register a request as in-flight.
   * The promise will be shared with any duplicate requests that arrive
   * before it resolves or the TTL expires.
   */
  set(key: string, promise: Promise<ProviderResponse>): void {
    this.inflight.set(key, {
      promise,
      createdAt: Date.now(),
    });

    // Clean up entry when promise settles (success or failure).
    // The void catch prevents unhandled rejection from the cleanup chain.
    promise.finally(() => {
      // Only delete if it's still our entry (not replaced by a newer one)
      const current = this.inflight.peek(key);
      if (current && current.promise === promise) {
        this.inflight.delete(key);
      }
    }).catch(() => {});
  }

  /** Number of currently in-flight deduplicated requests. */
  get size(): number {
    return this.inflight.size;
  }
}
