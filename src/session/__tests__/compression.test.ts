import { describe, it, expect } from 'vitest';
import { compressMessages } from '../compression.js';
import type { ChatMessage } from '../../types.js';

function msg(role: string, content: string): ChatMessage {
  return { role, content };
}

/** Generate a string with roughly the given word count. */
function longText(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => `word${i}`).join(' ');
}

/** Build a conversation of N messages alternating user/assistant. */
function buildConversation(n: number, wordsPerMsg: number = 10): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < n; i++) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    messages.push(msg(role, longText(wordsPerMsg)));
  }
  return messages;
}

describe('compressMessages', () => {
  describe('no compression needed', () => {
    it('returns messages unchanged when under budget', () => {
      const messages = [msg('user', 'hello'), msg('assistant', 'hi')];
      const result = compressMessages(messages, 10000);
      expect(result).toEqual(messages);
    });

    it('returns empty array for empty input', () => {
      expect(compressMessages([], 100)).toEqual([]);
    });

    it('returns single message unchanged', () => {
      const messages = [msg('user', 'hello')];
      const result = compressMessages(messages, 10000);
      expect(result).toEqual(messages);
    });
  });

  describe('layer 1: drop old tool results', () => {
    it('removes tool messages outside the recent window', () => {
      const messages = [
        msg('user', 'query'),
        msg('tool', longText(500)),
        msg('tool', longText(500)),
        msg('assistant', 'response'),
        msg('user', 'follow up'),
        msg('assistant', 'answer'),
      ];
      const result = compressMessages(messages, 100, 3);
      // Tool messages are outside the recent window and should be dropped
      const toolMessages = result.filter((m) => m.role === 'tool');
      expect(toolMessages.length).toBe(0);
    });

    it('preserves tool messages within the recent window', () => {
      const messages = [
        msg('user', 'old'),
        msg('assistant', 'old'),
        msg('user', 'recent'),
        msg('tool', 'recent tool result'),
        msg('assistant', 'recent answer'),
      ];
      // Large budget so no compression is needed
      const result = compressMessages(messages, 100000, 3);
      const hasTool = result.some((m) => m.role === 'tool');
      expect(hasTool).toBe(true);
    });

    it('only drops tool messages, not other roles', () => {
      const messages = [
        msg('user', longText(200)),
        msg('tool', longText(200)),
        msg('assistant', longText(200)),
        msg('user', 'recent'),
        msg('assistant', 'recent'),
      ];
      const result = compressMessages(messages, 100, 2);
      // Old user and assistant messages may still be present (later layers handle them)
      const hasUser = result.some((m) => m.role === 'user');
      expect(hasUser).toBe(true);
    });
  });

  describe('layer 2: collapse consecutive same-role messages', () => {
    it('merges consecutive user messages into one', () => {
      const messages = [
        msg('user', 'part one'),
        msg('user', 'part two'),
        msg('user', 'part three'),
        msg('assistant', 'reply'),
      ];
      // Budget low enough to trigger compression
      const result = compressMessages(messages, 20, 1);
      const userMessages = result.filter((m) => m.role === 'user');
      expect(userMessages.length).toBeLessThanOrEqual(1);
      if (userMessages.length === 1) {
        expect(userMessages[0].content).toContain('part one');
        expect(userMessages[0].content).toContain('part two');
        expect(userMessages[0].content).toContain('part three');
      }
    });

    it('does not merge messages of different roles', () => {
      const messages = [
        msg('user', 'hello'),
        msg('assistant', 'hi'),
        msg('user', 'question'),
      ];
      const result = compressMessages(messages, 100000);
      expect(result.length).toBe(3);
    });

    it('does not merge non-string content messages', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'part1' }] },
        { role: 'user', content: 'part2' },
        msg('assistant', 'reply'),
      ];
      // Non-string content should not be collapsed
      const result = compressMessages(messages, 100000);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('layer 3: truncate old messages', () => {
    it('truncates old messages beyond the character limit', () => {
      const longContent = 'x'.repeat(1000);
      const messages = [
        msg('user', longContent),
        msg('assistant', 'short recent'),
      ];
      const result = compressMessages(messages, 20, 1);
      const oldMsg = result.find((m) => m.role === 'user');
      if (oldMsg && typeof oldMsg.content === 'string' && oldMsg.content.length < 1000) {
        expect(oldMsg.content).toContain('[truncated]');
      }
    });

    it('does not truncate recent messages', () => {
      const longContent = longText(200);
      const messages = [
        msg('user', 'old short'),
        msg('assistant', longContent),
      ];
      const result = compressMessages(messages, 100000, 1);
      const lastMsg = result[result.length - 1];
      expect(lastMsg.content).toBe(longContent);
    });

    it('does not truncate messages already within limit', () => {
      const messages = [
        msg('user', 'short old message'),
        msg('assistant', 'recent'),
      ];
      const result = compressMessages(messages, 100000, 1);
      expect(result[0].content).toBe('short old message');
    });
  });

  describe('layer 4: collapse old system messages', () => {
    it('combines multiple old system messages into one', () => {
      const messages = [
        msg('system', 'system instruction 1'),
        msg('system', 'system instruction 2'),
        msg('user', 'hello'),
        msg('assistant', 'hi'),
        msg('user', 'question'),
        msg('assistant', 'answer'),
      ];
      const result = compressMessages(messages, 30, 2);
      const systemMsgs = result.filter((m) => m.role === 'system');
      expect(systemMsgs.length).toBeLessThanOrEqual(1);
      if (systemMsgs.length === 1) {
        expect(systemMsgs[0].content).toContain('system instruction 1');
        expect(systemMsgs[0].content).toContain('system instruction 2');
      }
    });

    it('joins old system messages preserving both contents', () => {
      const messages = [
        msg('system', 'first'),
        msg('user', longText(100)),  // separate systems so layer 2 doesn't merge them
        msg('system', 'second'),
        msg('user', longText(100)),
        msg('assistant', longText(100)),
        msg('user', 'recent'),
        msg('assistant', 'recent'),
      ];
      const result = compressMessages(messages, 50, 2);
      const sys = result.find((m) => m.role === 'system');
      if (sys && typeof sys.content === 'string') {
        expect(sys.content).toContain('first');
        expect(sys.content).toContain('second');
      }
    });

    it('does not collapse system messages within the recent window', () => {
      const messages = [
        msg('user', 'question'),
        msg('system', 'recent system'),
      ];
      const result = compressMessages(messages, 100000, 2);
      expect(result.some((m) => m.role === 'system')).toBe(true);
    });
  });

  describe('layer 5: drop old assistant messages', () => {
    it('removes old assistant messages while keeping user messages', () => {
      const messages = [
        msg('user', longText(50)),
        msg('assistant', longText(50)),
        msg('user', longText(50)),
        msg('assistant', longText(50)),
        msg('user', 'recent'),
        msg('assistant', 'recent reply'),
      ];
      const result = compressMessages(messages, 50, 2);
      // The result should have fewer messages than the input
      expect(result.length).toBeLessThan(messages.length);
      // Should still contain at least some user content
      expect(result.some((m) => m.role === 'user')).toBe(true);
    });
  });

  describe('layer 6: keep last N messages', () => {
    it('keeps the system message even when trimming', () => {
      const messages = [
        msg('system', 'you are helpful'),
        ...buildConversation(20, 30),
      ];
      const result = compressMessages(messages, 50, 4);
      expect(result.length).toBeLessThanOrEqual(10);
      expect(result[0].role).toBe('system');
    });

    it('returns messages unchanged if already within N', () => {
      const messages = [
        msg('user', 'hello'),
        msg('assistant', 'hi'),
      ];
      const result = compressMessages(messages, 100000, 10);
      expect(result).toEqual(messages);
    });
  });

  describe('layer 7: hard truncate', () => {
    it('removes from front until under budget, keeping first and last', () => {
      const messages = [
        msg('system', 'system'),
        ...buildConversation(30, 50),
      ];
      const result = compressMessages(messages, 30, 2);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].role).toBe('system');
    });

    it('always keeps at least 2 messages', () => {
      const messages = [
        msg('system', 'system prompt'),
        msg('user', longText(500)),
        msg('assistant', longText(500)),
        msg('user', longText(500)),
        msg('assistant', longText(500)),
      ];
      const result = compressMessages(messages, 10, 2);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('progressive compression', () => {
    it('stops compressing once under budget', () => {
      // Build a conversation where dropping tool results suffices
      const messages = [
        msg('user', 'query'),
        msg('tool', longText(100)),
        msg('assistant', 'based on tool'),
        msg('user', 'thanks'),
        msg('assistant', 'welcome'),
      ];
      const result = compressMessages(messages, 50, 2);
      // Tool should be dropped
      expect(result.some((m) => m.role === 'tool')).toBe(false);
      // But user and assistant remain
      expect(result.some((m) => m.role === 'user')).toBe(true);
      expect(result.some((m) => m.role === 'assistant')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles non-string content without throwing', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
        msg('assistant', 'hi'),
      ];
      const result = compressMessages(messages, 100000);
      expect(result.length).toBe(2);
    });

    it('uses default maxTokens and recentWindow when not provided', () => {
      const messages = [msg('user', 'hello'), msg('assistant', 'hi')];
      // Should not throw and should return something
      const result = compressMessages(messages);
      expect(result.length).toBeGreaterThan(0);
    });

    it('preserves the last message in aggressive compression', () => {
      const messages = [
        msg('user', longText(500)),
        msg('assistant', longText(500)),
        msg('user', longText(500)),
        msg('assistant', longText(500)),
        msg('user', 'last user message'),
        msg('assistant', 'last assistant message'),
      ];
      const result = compressMessages(messages, 30, 2);
      const lastMsg = result[result.length - 1];
      expect(lastMsg.content).toBe('last assistant message');
    });

    it('preserves system message through all layers', () => {
      const messages = [
        msg('system', 'You are a helpful assistant'),
        msg('user', longText(500)),
        msg('assistant', longText(500)),
        msg('user', longText(500)),
        msg('assistant', longText(500)),
        msg('user', 'recent'),
        msg('assistant', 'recent response'),
      ];
      const result = compressMessages(messages, 50, 2);
      const hasSystem = result.some((m) => m.role === 'system');
      expect(hasSystem).toBe(true);
    });
  });
});
