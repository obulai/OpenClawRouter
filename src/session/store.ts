import { LRUCache } from 'lru-cache';
import { createHash } from 'node:crypto';

export interface Session {
  model: string;
  consecutiveCount: number;
  createdAt: number;
  lastAccessAt: number;
}

export class SessionStore {
  private sessions: LRUCache<string, Session>;
  private ttlMs: number;

  constructor(ttlMs: number = 30 * 60 * 1000, maxSessions: number = 1000) {
    this.ttlMs = ttlMs;
    this.sessions = new LRUCache<string, Session>({
      max: maxSessions,
      ttl: ttlMs,
    });
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  updateSession(sessionId: string, model: string): void {
    const existing = this.sessions.get(sessionId);
    const now = Date.now();

    if (existing) {
      existing.consecutiveCount =
        existing.model === model ? existing.consecutiveCount + 1 : 1;
      existing.model = model;
      existing.lastAccessAt = now;
      this.sessions.set(sessionId, existing);
    } else {
      this.sessions.set(sessionId, {
        model,
        consecutiveCount: 1,
        createdAt: now,
        lastAccessAt: now,
      });
    }
  }

  static deriveSessionId(
    headers: Record<string, string>,
    messages: unknown[],
  ): string {
    // Use explicit session header if present
    const explicit =
      headers['x-session-id'] ??
      headers['x-request-id'] ??
      headers['x-conversation-id'];
    if (explicit) return explicit;

    // Fall back to hashing the first message content
    const firstMsg = messages[0];
    const content =
      firstMsg && typeof firstMsg === 'object' && firstMsg !== null
        ? JSON.stringify((firstMsg as Record<string, unknown>).content ?? '')
        : '';

    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}
