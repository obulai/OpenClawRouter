import { ChatCompletionRequest, RoutingProfile } from '../types.js';
import { classifyRequest, ClassificationResult } from './classifier.js';
import { selectModelForTier, selectModelWithFallback } from './selector.js';

export interface RoutingDecision {
  model: string;
  classification?: ClassificationResult;
  explicit: boolean;
}

export function makeRoutingDecision(
  request: ChatCompletionRequest,
  profile: RoutingProfile,
  availableModels: string[],
): RoutingDecision {
  const requestedModel = request.model?.trim() ?? '';

  // Explicit model selection — user specified a concrete model
  if (requestedModel && requestedModel !== 'auto') {
    return {
      model: requestedModel,
      explicit: true,
    };
  }

  // Smart routing: classify the request and pick the best model
  const classification = classifyRequest(request);
  const model = selectModelWithFallback(
    classification.tier,
    profile,
    availableModels,
  );

  return {
    model,
    classification,
    explicit: false,
  };
}
