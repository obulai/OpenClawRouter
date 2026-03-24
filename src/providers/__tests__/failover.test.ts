import { describe, it, expect } from 'vitest';
import { isRetryableError, buildProviderUrl } from '../failover.js';
import type { ProviderConfig } from '../../types.js';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test',
    name: 'Test',
    scheme: 'https',
    host: 'api.example.com',
    path_prefix: '',
    api_format: 'openai',
    priority: 1,
    enabled: true,
    dynamic_pricing: false,
    headers: {},
    ...overrides,
  };
}

describe('isRetryableError', () => {
  it('should treat 5xx as retryable', () => {
    expect(isRetryableError(500)).toBe(true);
    expect(isRetryableError(502)).toBe(true);
    expect(isRetryableError(503)).toBe(true);
    expect(isRetryableError(504)).toBe(true);
  });

  it('should treat 429 as retryable', () => {
    expect(isRetryableError(429)).toBe(true);
  });

  it('should treat 4xx (except 429) as terminal', () => {
    expect(isRetryableError(400)).toBe(false);
    expect(isRetryableError(401)).toBe(false);
    expect(isRetryableError(403)).toBe(false);
    expect(isRetryableError(404)).toBe(false);
    expect(isRetryableError(422)).toBe(false);
  });

  it('should treat 2xx and 3xx as non-retryable', () => {
    expect(isRetryableError(200)).toBe(false);
    expect(isRetryableError(301)).toBe(false);
  });
});

describe('buildProviderUrl', () => {
  it('should build URL from provider and client path', () => {
    const provider = makeProvider({ host: 'api.example.com', path_prefix: '' });
    expect(buildProviderUrl(provider, '/v1/chat/completions')).toBe(
      'https://api.example.com/v1/chat/completions',
    );
  });

  it('should include path_prefix', () => {
    const provider = makeProvider({ host: 'api.example.com', path_prefix: '/llm' });
    expect(buildProviderUrl(provider, '/v1/chat/completions')).toBe(
      'https://api.example.com/llm/v1/chat/completions',
    );
  });

  it('should use pathOverride when provided', () => {
    const provider = makeProvider({ host: 'api.example.com', path_prefix: '' });
    expect(buildProviderUrl(provider, '/v1/chat/completions', '/api/llm/claude-opus')).toBe(
      'https://api.example.com/api/llm/claude-opus',
    );
  });

  it('should handle http scheme', () => {
    const provider = makeProvider({ scheme: 'http', host: 'localhost:8080', path_prefix: '' });
    expect(buildProviderUrl(provider, '/v1/chat/completions')).toBe(
      'http://localhost:8080/v1/chat/completions',
    );
  });
});
