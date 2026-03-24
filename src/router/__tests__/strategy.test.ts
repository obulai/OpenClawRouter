import { describe, it, expect } from 'vitest';
import { makeRoutingDecision } from '../strategy.js';
import { ChatCompletionRequest } from '../../types.js';

const ALL_MODELS = [
  'gemini-3.1-flash-lite',
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'gpt-5',
  'deepseek-v3.2',
];

function makeRequest(model: string, content: string): ChatCompletionRequest {
  return {
    model,
    messages: [{ role: 'user', content }],
  };
}

describe('makeRoutingDecision', () => {
  it('uses explicit model when specified', () => {
    const decision = makeRoutingDecision(
      makeRequest('gpt-5', 'Hello'),
      'auto',
      ALL_MODELS,
    );
    expect(decision.model).toBe('gpt-5');
    expect(decision.explicit).toBe(true);
    expect(decision.classification).toBeUndefined();
  });

  it('classifies and selects when model is "auto"', () => {
    const decision = makeRoutingDecision(
      makeRequest('auto', 'What is 2+2?'),
      'auto',
      ALL_MODELS,
    );
    expect(decision.explicit).toBe(false);
    expect(decision.classification).toBeDefined();
    expect(decision.classification!.tier).toBeDefined();
    expect(ALL_MODELS).toContain(decision.model);
  });

  it('classifies and selects when model is empty', () => {
    const decision = makeRoutingDecision(
      makeRequest('', 'What is the meaning of life?'),
      'auto',
      ALL_MODELS,
    );
    expect(decision.explicit).toBe(false);
    expect(decision.classification).toBeDefined();
  });

  it('respects the routing profile for model selection', () => {
    const ecoDecision = makeRoutingDecision(
      makeRequest('auto', 'Hi'),
      'eco',
      ALL_MODELS,
    );
    const premiumDecision = makeRoutingDecision(
      makeRequest('auto', 'Hi'),
      'premium',
      ALL_MODELS,
    );
    // Both smart-route but may pick different models
    expect(ecoDecision.explicit).toBe(false);
    expect(premiumDecision.explicit).toBe(false);
  });

  it('handles whitespace-only model as smart routing', () => {
    const decision = makeRoutingDecision(
      makeRequest('   ', 'Tell me a joke'),
      'auto',
      ALL_MODELS,
    );
    expect(decision.explicit).toBe(false);
    expect(decision.classification).toBeDefined();
  });
});
