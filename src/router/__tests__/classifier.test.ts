import { describe, it, expect } from 'vitest';
import { classifyRequest } from '../classifier.js';
import { ChatCompletionRequest } from '../../types.js';

function makeRequest(content: string, extraMessages: { role: string; content: string }[] = []): ChatCompletionRequest {
  return {
    model: 'auto',
    messages: [{ role: 'user', content }, ...extraMessages],
  };
}

describe('classifyRequest', () => {
  it('classifies a simple factual question as SIMPLE', () => {
    const result = classifyRequest(makeRequest('What is the capital of France?'));
    expect(result.tier).toBe('simple');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.scores).toBeDefined();
  });

  it('classifies a code generation request as COMPLEX or higher', () => {
    const result = classifyRequest(
      makeRequest(
        'Write a Python function that implements a binary search tree with insert, delete, and search operations. Include proper error handling, type hints, and unit tests. The implementation should handle edge cases like duplicate values and empty trees.',
      ),
    );
    expect(['complex', 'reasoning']).toContain(result.tier);
  });

  it('classifies "explain step by step" as MEDIUM or COMPLEX', () => {
    const result = classifyRequest(
      makeRequest('Explain step by step how a neural network learns through backpropagation.'),
    );
    expect(['medium', 'complex']).toContain(result.tier);
  });

  it('classifies a very short message as SIMPLE', () => {
    const result = classifyRequest(makeRequest('Hi'));
    expect(result.tier).toBe('simple');
  });

  it('classifies multi-step with constraints as COMPLEX', () => {
    const result = classifyRequest(
      makeRequest(
        'First, analyze the given database schema. Then, write exactly 5 SQL queries that must each return no more than 100 rows. Step 3: compare the performance of each query. Finally, provide a detailed optimization plan with at least 3 specific recommendations for improving throughput and reducing latency.',
      ),
    );
    expect(['complex', 'reasoning']).toContain(result.tier);
  });

  it('defaults to MEDIUM when confidence is low', () => {
    // A very ambiguous request — moderate length, no strong signals
    const result = classifyRequest(makeRequest('Tell me something interesting.'));
    // The confidence mechanism should keep this at simple or medium
    expect(['simple', 'medium']).toContain(result.tier);
  });

  it('returns scores for all 14 dimensions', () => {
    const result = classifyRequest(makeRequest('Hello world'));
    const dimensionKeys = [
      'codePresence', 'reasoningMarkers', 'technicalTerms', 'creativeIndicators',
      'constraintWords', 'multiStepPatterns', 'agenticSignals', 'tokenCount',
      'questionComplexity', 'languageComplexity', 'domainSpecificity',
      'outputFormatting', 'contextLength', 'toolUseSignals',
    ];
    for (const key of dimensionKeys) {
      expect(result.scores).toHaveProperty(key);
      expect(result.scores[key]).toBeGreaterThanOrEqual(0);
      expect(result.scores[key]).toBeLessThanOrEqual(1);
    }
  });

  it('gives higher scores to requests with code blocks', () => {
    const withCode = classifyRequest(
      makeRequest('```python\ndef foo():\n  return 42\n```\nExplain this code.'),
    );
    const withoutCode = classifyRequest(makeRequest('Tell me about Python.'));
    expect(withCode.scores.codePresence).toBeGreaterThan(withoutCode.scores.codePresence);
  });

  it('handles multi-part content arrays', () => {
    const request: ChatCompletionRequest = {
      model: 'auto',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Analyze this algorithm step by step' },
          ],
        },
      ],
    };
    const result = classifyRequest(request);
    expect(result.scores.reasoningMarkers).toBeGreaterThan(0);
  });
});
