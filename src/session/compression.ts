import type { ChatMessage } from '../types.js';

/**
 * 7-layer context compression for long conversations.
 *
 * When a conversation exceeds the token budget, progressively compress
 * older messages while preserving recent context and key information.
 *
 * Layers (applied in order as needed):
 * 1. Drop tool results beyond the most recent N turns
 * 2. Collapse consecutive same-role messages
 * 3. Truncate individual messages beyond a character limit
 * 4. Summarize older system messages
 * 5. Drop assistant messages older than the window, keep user messages
 * 6. Keep only the last N exchanges
 * 7. Truncate the remaining to fit within budget
 */

const DEFAULT_MAX_TOKENS = 8000;
const DEFAULT_RECENT_WINDOW = 6; // keep last 6 messages uncompressed

/** Rough token estimate: words * 1.3 */
function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function messageTokens(msg: ChatMessage): number {
  const content = typeof msg.content === 'string'
    ? msg.content
    : JSON.stringify(msg.content);
  return estimateTokens(content) + 4; // overhead for role, formatting
}

function totalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + messageTokens(m), 0);
}

/** Layer 1: Drop tool results beyond the recent window. */
function dropOldToolResults(messages: ChatMessage[], recentWindow: number): ChatMessage[] {
  const cutoff = messages.length - recentWindow;
  return messages.filter((msg, i) => {
    if (i >= cutoff) return true;
    return msg.role !== 'tool';
  });
}

/** Layer 2: Collapse consecutive same-role messages. */
function collapseConsecutive(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;

  const result: ChatMessage[] = [messages[0]];

  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1];
    const curr = messages[i];

    if (prev.role === curr.role && typeof prev.content === 'string' && typeof curr.content === 'string') {
      result[result.length - 1] = {
        ...prev,
        content: `${prev.content}\n\n${curr.content}`,
      };
    } else {
      result.push(curr);
    }
  }

  return result;
}

/** Layer 3: Truncate individual old messages. */
function truncateOldMessages(messages: ChatMessage[], recentWindow: number, maxChars: number = 500): ChatMessage[] {
  const cutoff = messages.length - recentWindow;
  return messages.map((msg, i) => {
    if (i >= cutoff) return msg;
    if (typeof msg.content !== 'string') return msg;
    if (msg.content.length <= maxChars) return msg;
    return {
      ...msg,
      content: msg.content.slice(0, maxChars) + '... [truncated]',
    };
  });
}

/** Layer 4: Summarize old system messages into a single combined one. */
function collapseOldSystemMessages(messages: ChatMessage[], recentWindow: number): ChatMessage[] {
  const cutoff = messages.length - recentWindow;
  const oldSystems: string[] = [];
  const filtered: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    if (i < cutoff && messages[i].role === 'system' && typeof messages[i].content === 'string') {
      oldSystems.push(messages[i].content as string);
    } else {
      filtered.push(messages[i]);
    }
  }

  if (oldSystems.length > 0) {
    const combined: ChatMessage = {
      role: 'system',
      content: oldSystems.join('\n---\n'),
    };
    return [combined, ...filtered];
  }

  return filtered;
}

/** Layer 5: Drop old assistant messages, keep user messages. */
function dropOldAssistant(messages: ChatMessage[], recentWindow: number): ChatMessage[] {
  const cutoff = messages.length - recentWindow;
  return messages.filter((msg, i) => {
    if (i >= cutoff) return true;
    return msg.role !== 'assistant';
  });
}

/** Layer 6: Keep only the last N messages. */
function keepLastN(messages: ChatMessage[], n: number): ChatMessage[] {
  if (messages.length <= n) return messages;

  // Always keep the first system message if present
  const first = messages[0];
  const hasSystem = first.role === 'system';
  const tail = messages.slice(-n);

  if (hasSystem && tail[0] !== first) {
    return [first, ...tail.slice(1)];
  }

  return tail;
}

/** Layer 7: Hard truncate remaining messages from the front. */
function hardTruncate(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  // Remove from the front (oldest) until we fit
  const result = [...messages];
  while (result.length > 2 && totalTokens(result) > maxTokens) {
    // Keep first (usually system) and last (most recent)
    result.splice(1, 1);
  }
  return result;
}

/**
 * Compress messages to fit within a token budget.
 * Applies layers progressively — returns as soon as under budget.
 */
export function compressMessages(
  messages: ChatMessage[],
  maxTokens: number = DEFAULT_MAX_TOKENS,
  recentWindow: number = DEFAULT_RECENT_WINDOW,
): ChatMessage[] {
  if (messages.length === 0) return messages;

  let compressed = [...messages];

  // Check if already within budget
  if (totalTokens(compressed) <= maxTokens) return compressed;

  // Layer 1: Drop old tool results
  compressed = dropOldToolResults(compressed, recentWindow);
  if (totalTokens(compressed) <= maxTokens) return compressed;

  // Layer 2: Collapse consecutive same-role
  compressed = collapseConsecutive(compressed);
  if (totalTokens(compressed) <= maxTokens) return compressed;

  // Layer 3: Truncate old messages
  compressed = truncateOldMessages(compressed, recentWindow);
  if (totalTokens(compressed) <= maxTokens) return compressed;

  // Layer 4: Collapse old system messages
  compressed = collapseOldSystemMessages(compressed, recentWindow);
  if (totalTokens(compressed) <= maxTokens) return compressed;

  // Layer 5: Drop old assistant messages
  compressed = dropOldAssistant(compressed, recentWindow);
  if (totalTokens(compressed) <= maxTokens) return compressed;

  // Layer 6: Keep last N messages
  compressed = keepLastN(compressed, recentWindow + 2);
  if (totalTokens(compressed) <= maxTokens) return compressed;

  // Layer 7: Hard truncate
  compressed = hardTruncate(compressed, maxTokens);

  return compressed;
}
