import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes
const DEFAULT_MAX_ENTRIES = 200;

export interface CachedResponse {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  providerId: string;
  cachedAt: number;
}

/**
 * Response cache for completed, non-streaming requests.
 *
 * Caches successful (2xx) non-streaming responses keyed by a hash of
 * the request body. Streaming responses are never cached.
 */
export class ResponseCache {
  private cache: LRUCache<string, CachedResponse>;

  constructor(ttlMs: number = DEFAULT_TTL_MS, maxEntries: number = DEFAULT_MAX_ENTRIES) {
    this.cache = new LRUCache<string, CachedResponse>({
      max: maxEntries,
      ttl: ttlMs,
    });
  }

  /**
   * Build a cache key from the request body.
   * Includes the model to avoid cross-model cache hits if bodies otherwise match.
   */
  static buildKey(model: string, body: Buffer): string {
    const hash = createHash('sha256').update(body).digest('hex');
    return `${model}::${hash}`;
  }

  /**
   * Get a cached response if available and fresh.
   */
  get(key: string): CachedResponse | undefined {
    return this.cache.get(key);
  }

  /**
   * Cache a successful response.
   * Only call this for 2xx non-streaming responses.
   */
  set(key: string, entry: CachedResponse): void {
    this.cache.set(key, entry);
  }

  /** Number of cached entries. */
  get size(): number {
    return this.cache.size;
  }
}
