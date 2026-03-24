import type { RoutingConfig, Category, ProviderConfig } from '../types.js';

export class ProviderRegistry {
  /** model name → categoryId */
  private modelIndex: Map<string, string>;

  constructor(private config: RoutingConfig) {
    this.modelIndex = new Map();
    for (const [categoryId, category] of Object.entries(config.categories)) {
      if (categoryId.startsWith('llm/')) {
        this.modelIndex.set(category.model, categoryId);
      }
    }
  }

  /**
   * Find the category for a model name (e.g., "claude-opus-4-6" → "llm/claude-opus-4-6").
   */
  getCategoryForModel(model: string): { categoryId: string; category: Category } | undefined {
    const categoryId = this.modelIndex.get(model);
    if (categoryId === undefined) return undefined;
    const category = this.config.categories[categoryId];
    if (category === undefined) return undefined;
    return { categoryId, category };
  }

  /**
   * Get all enabled providers for a model, sorted by priority (ascending).
   */
  getProvidersForModel(model: string): ProviderConfig[] {
    const result = this.getCategoryForModel(model);
    if (!result) return [];
    return result.category.providers
      .filter((p) => p.enabled)
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Direct category lookup by categoryId.
   */
  getCategory(categoryId: string): Category | undefined {
    return this.config.categories[categoryId];
  }

  /**
   * List all available model names across llm/* categories.
   */
  listModels(): string[] {
    return Array.from(this.modelIndex.keys()).sort();
  }
}
