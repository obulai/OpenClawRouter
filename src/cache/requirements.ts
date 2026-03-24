import { LRUCache } from 'lru-cache';
import type { ProviderConfig } from '../types.js';

export interface CachedRequirement {
  maxAmountRequired: string;
  ttl: number;
  cachedAt: number;
  dynamicPricing: boolean;
}

const NEGATIVE_SENTINEL = '__NEGATIVE__';
const NEGATIVE_TTL_MS = 10_000;

export class RequirementsCache {
  private cache: LRUCache<string, CachedRequirement>;

  constructor(maxEntries = 500) {
    this.cache = new LRUCache<string, CachedRequirement>({ max: maxEntries });
  }

  /**
   * Get cached requirement if fresh.
   */
  get(key: string): CachedRequirement | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (!this.isEntryFresh(entry)) {
      this.cache.delete(key);
      return undefined;
    }
    if (entry.maxAmountRequired === NEGATIVE_SENTINEL) return undefined;
    return entry;
  }

  /**
   * Check if entry exists and is fresh (not expired).
   */
  isFresh(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    return this.isEntryFresh(entry);
  }

  /**
   * Store requirement with TTL.
   */
  set(key: string, req: CachedRequirement): void {
    this.cache.set(key, req);
  }

  /**
   * Negative cache — store a short-lived entry indicating a failed probe.
   */
  setNegative(key: string): void {
    this.cache.set(key, {
      maxAmountRequired: NEGATIVE_SENTINEL,
      ttl: NEGATIVE_TTL_MS / 1000,
      cachedAt: Date.now(),
      dynamicPricing: false,
    });
  }

  /**
   * Check if an entry is negative-cached and still fresh.
   */
  isNegativeCached(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (!this.isEntryFresh(entry)) {
      this.cache.delete(key);
      return false;
    }
    return entry.maxAmountRequired === NEGATIVE_SENTINEL;
  }

  /**
   * Build cache key from provider config and path.
   */
  static buildKey(provider: ProviderConfig, path: string): string {
    return `${provider.id}::${path}`;
  }

  private isEntryFresh(entry: CachedRequirement): boolean {
    const ageMs = Date.now() - entry.cachedAt;
    return ageMs < entry.ttl * 1000;
  }
}
