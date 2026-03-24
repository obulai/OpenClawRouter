import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../registry.js';
import type { RoutingConfig, ProviderConfig } from '../../types.js';

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    scheme: 'https',
    host: 'api.test.com',
    path_prefix: '',
    api_format: 'openai',
    priority: 1,
    enabled: true,
    dynamic_pricing: false,
    headers: {},
    ...overrides,
  };
}

function makeConfig(): RoutingConfig {
  return {
    categories: {
      'llm/claude-opus-4-6': {
        display_name: 'Claude Opus 4.6',
        model: 'claude-opus-4-6',
        providers: [
          makeProvider({ id: 'provider-a', priority: 2 }),
          makeProvider({ id: 'provider-b', priority: 1 }),
          makeProvider({ id: 'provider-c', priority: 3, enabled: false }),
        ],
      },
      'llm/gpt-5': {
        display_name: 'GPT-5',
        model: 'gpt-5',
        providers: [
          makeProvider({ id: 'provider-d', priority: 1 }),
        ],
      },
      'image/dalle-4': {
        display_name: 'DALL-E 4',
        model: 'dall-e-4',
        providers: [
          makeProvider({ id: 'provider-e', priority: 1 }),
        ],
      },
    },
  };
}

describe('ProviderRegistry', () => {
  describe('getCategoryForModel', () => {
    it('should find category for a known model', () => {
      const registry = new ProviderRegistry(makeConfig());
      const result = registry.getCategoryForModel('claude-opus-4-6');
      expect(result).toBeDefined();
      expect(result!.categoryId).toBe('llm/claude-opus-4-6');
      expect(result!.category.display_name).toBe('Claude Opus 4.6');
    });

    it('should return undefined for unknown model', () => {
      const registry = new ProviderRegistry(makeConfig());
      expect(registry.getCategoryForModel('unknown-model')).toBeUndefined();
    });

    it('should not index non-llm categories', () => {
      const registry = new ProviderRegistry(makeConfig());
      // dall-e-4 is under image/, not llm/
      expect(registry.getCategoryForModel('dall-e-4')).toBeUndefined();
    });
  });

  describe('getProvidersForModel', () => {
    it('should return enabled providers sorted by priority', () => {
      const registry = new ProviderRegistry(makeConfig());
      const providers = registry.getProvidersForModel('claude-opus-4-6');
      expect(providers).toHaveLength(2);
      expect(providers[0].id).toBe('provider-b'); // priority 1
      expect(providers[1].id).toBe('provider-a'); // priority 2
    });

    it('should return empty array for unknown model', () => {
      const registry = new ProviderRegistry(makeConfig());
      expect(registry.getProvidersForModel('nonexistent')).toEqual([]);
    });

    it('should exclude disabled providers', () => {
      const registry = new ProviderRegistry(makeConfig());
      const providers = registry.getProvidersForModel('claude-opus-4-6');
      const ids = providers.map((p) => p.id);
      expect(ids).not.toContain('provider-c');
    });
  });

  describe('getCategory', () => {
    it('should return category by id', () => {
      const registry = new ProviderRegistry(makeConfig());
      const cat = registry.getCategory('llm/gpt-5');
      expect(cat).toBeDefined();
      expect(cat!.model).toBe('gpt-5');
    });

    it('should return undefined for unknown category', () => {
      const registry = new ProviderRegistry(makeConfig());
      expect(registry.getCategory('llm/nonexistent')).toBeUndefined();
    });
  });

  describe('listModels', () => {
    it('should list all llm models sorted alphabetically', () => {
      const registry = new ProviderRegistry(makeConfig());
      const models = registry.listModels();
      expect(models).toEqual(['claude-opus-4-6', 'gpt-5']);
    });
  });
});
