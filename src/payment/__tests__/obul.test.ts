import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObulPaymentBackend } from '../obul.js';
import type { ProviderConfig } from '../../types.js';

const mockProvider: ProviderConfig = {
  id: 'test-provider',
  name: 'Test Provider',
  scheme: 'https',
  host: 'x402engine.app',
  path_prefix: '/api/llm',
  api_format: 'x402engine',
  priority: 1,
  enabled: true,
  dynamic_pricing: false,
  headers: {},
};

describe('ObulPaymentBackend', () => {
  describe('URL rewriting', () => {
    it('rewrites x402engine URL correctly', () => {
      const backend = new ObulPaymentBackend('test-key');
      const result = backend.rewriteUrl('https://x402engine.app/api/llm/claude-opus');
      expect(result).toBe(
        'https://obul.polymerdao.xyz/proxy/https/x402engine.app/api/llm/claude-opus'
      );
    });

    it('rewrites blockrun URL correctly', () => {
      const backend = new ObulPaymentBackend('test-key');
      const result = backend.rewriteUrl('https://blockrun.ai/api/v1/chat/completions');
      expect(result).toBe(
        'https://obul.polymerdao.xyz/proxy/https/blockrun.ai/api/v1/chat/completions'
      );
    });

    it('handles http scheme', () => {
      const backend = new ObulPaymentBackend('test-key');
      const result = backend.rewriteUrl('http://localhost:3000/api/test');
      expect(result).toBe(
        'https://obul.polymerdao.xyz/proxy/http/localhost:3000/api/test'
      );
    });

    it('uses custom base URL', () => {
      const backend = new ObulPaymentBackend('test-key', 'https://custom.obul.xyz');
      const result = backend.rewriteUrl('https://x402engine.app/api/llm/claude-opus');
      expect(result).toBe(
        'https://custom.obul.xyz/proxy/https/x402engine.app/api/llm/claude-opus'
      );
    });

    it('strips trailing slash from base URL', () => {
      const backend = new ObulPaymentBackend('test-key', 'https://custom.obul.xyz/');
      const result = backend.rewriteUrl('https://x402engine.app/api/llm/claude-opus');
      expect(result).toBe(
        'https://custom.obul.xyz/proxy/https/x402engine.app/api/llm/claude-opus'
      );
    });
  });

  describe('sendRequest', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('adds x-obul-api-key header', async () => {
      const mockResponse = {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        arrayBuffer: async () => new ArrayBuffer(0),
        body: null,
      };
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const backend = new ObulPaymentBackend('my-secret-key');
      await backend.sendRequest({
        provider: mockProvider,
        url: 'https://x402engine.app/api/llm/claude-opus',
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{}'),
        stream: false,
      });

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [calledUrl, calledInit] = fetchSpy.mock.calls[0];
      expect(calledUrl).toBe(
        'https://obul.polymerdao.xyz/proxy/https/x402engine.app/api/llm/claude-opus'
      );
      const headers = calledInit?.headers as Record<string, string>;
      expect(headers['x-obul-api-key']).toBe('my-secret-key');
      expect(headers['content-type']).toBe('application/json');
    });

    it('returns response with status, headers, and body', async () => {
      const responseBody = JSON.stringify({ result: 'ok' });
      const mockResponse = {
        status: 200,
        headers: new Headers({
          'content-type': 'application/json',
          'x-custom': 'value',
        }),
        arrayBuffer: async () => new TextEncoder().encode(responseBody).buffer,
        body: null,
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse as Response);

      const backend = new ObulPaymentBackend('key');
      const result = await backend.sendRequest({
        provider: mockProvider,
        url: 'https://x402engine.app/api/llm/test',
        method: 'POST',
        headers: {},
        body: Buffer.from('{}'),
        stream: false,
      });

      expect(result.status).toBe(200);
      expect(result.headers['content-type']).toBe('application/json');
      expect(result.body.toString()).toBe(responseBody);
    });
  });
});
