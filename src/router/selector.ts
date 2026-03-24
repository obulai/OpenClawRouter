import { ComplexityTier, RoutingProfile } from '../types.js';

const TIER_MODELS: Record<RoutingProfile, Record<ComplexityTier, string>> = {
  auto: {
    simple: 'gemini-3.1-flash-lite',
    medium: 'claude-sonnet-4-6',
    complex: 'claude-opus-4-6',
    reasoning: 'claude-opus-4-6',
  },
  eco: {
    simple: 'gemini-3.1-flash-lite',
    medium: 'deepseek-v3.2',
    complex: 'claude-sonnet-4-6',
    reasoning: 'claude-sonnet-4-6',
  },
  premium: {
    simple: 'claude-sonnet-4-6',
    medium: 'claude-opus-4-6',
    complex: 'gpt-5',
    reasoning: 'claude-opus-4-6',
  },
  agentic: {
    simple: 'claude-sonnet-4-6',
    medium: 'claude-sonnet-4-6',
    complex: 'claude-opus-4-6',
    reasoning: 'claude-opus-4-6',
  },
};

/** Tier priority order for fallback (higher complexity first). */
const TIER_PRIORITY: ComplexityTier[] = ['reasoning', 'complex', 'medium', 'simple'];

export function selectModelForTier(
  tier: ComplexityTier,
  profile: RoutingProfile,
): string {
  return TIER_MODELS[profile][tier];
}

export function selectModelWithFallback(
  tier: ComplexityTier,
  profile: RoutingProfile,
  availableModels: string[],
): string {
  const primary = TIER_MODELS[profile][tier];
  if (availableModels.includes(primary)) return primary;

  // Walk tiers by priority: try same-profile tiers that are available
  const profileMap = TIER_MODELS[profile];
  for (const t of TIER_PRIORITY) {
    if (availableModels.includes(profileMap[t])) {
      return profileMap[t];
    }
  }

  // Last resort: return first available model
  if (availableModels.length > 0) return availableModels[0];

  // Nothing available — return the primary anyway and let upstream handle the error
  return primary;
}
