import type { ProviderConfig, PaymentBackend } from '../types.js';
import { RequirementsCache } from '../cache/requirements.js';
import { probePathForFormat } from './translate/index.js';
import { logger } from '../logger.js';

export interface PricingResult {
  providerId: string;
  price: number | null;
  error?: string;
}

/**
 * Build a minimal ChatCompletion probe body for pricing discovery.
 */
function buildProbeBody(model: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    }),
  );
}

/**
 * Parse maxAmountRequired from a 402 response.
 * Looks in the response body (JSON) and falls back to the payment-required header.
 */
function parseMaxAmount(body: Buffer, headers: Record<string, string>): string | null {
  // Try parsing from body first
  try {
    const parsed = JSON.parse(body.toString());
    if (parsed && typeof parsed === 'object') {
      // x402 puts requirements in various shapes
      const amount =
        parsed.maxAmountRequired ??
        parsed.max_amount_required ??
        parsed?.accepts?.[0]?.maxAmountRequired ??
        null;
      if (amount !== null && amount !== undefined) {
        return String(amount);
      }
    }
  } catch {
    // Not JSON, try header
  }

  // Fallback: check payment-required header
  const headerVal = headers['payment-required'] ?? headers['Payment-Required'];
  if (headerVal) {
    try {
      const parsed = JSON.parse(headerVal);
      const amount = parsed.maxAmountRequired ?? parsed?.accepts?.[0]?.maxAmountRequired;
      if (amount !== null && amount !== undefined) {
        return String(amount);
      }
    } catch {
      // Header wasn't JSON, return raw
      return headerVal;
    }
  }

  return null;
}

/**
 * Probe a single provider for pricing.
 * Sends a minimal request expecting a 402 response, then parses requirements.
 */
export async function probeProviderPricing(
  provider: ProviderConfig,
  model: string,
  paymentBackend: PaymentBackend,
): Promise<PricingResult> {
  const probePath = probePathForFormat(provider.api_format, model);
  const url = `${provider.scheme}://${provider.host}${provider.path_prefix}${probePath}`;

  try {
    const response = await paymentBackend.sendRequest({
      provider,
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: buildProbeBody(model),
      stream: false,
    });

    if (response.status === 402) {
      const maxAmount = parseMaxAmount(response.body, response.headers);
      if (maxAmount !== null) {
        const price = Number(maxAmount);
        if (!isNaN(price)) {
          return { providerId: provider.id, price };
        }
      }
      return { providerId: provider.id, price: null, error: 'Could not parse price from 402' };
    }

    // Non-402 response — probe didn't get pricing info
    return {
      providerId: provider.id,
      price: null,
      error: `Unexpected status ${response.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { providerId: provider.id, price: null, error: message };
  }
}

/**
 * Probe all providers in parallel with a timeout.
 * Returns a map of providerId → price (null if probe failed).
 * Uses the requirements cache to skip fresh entries and store results.
 */
export async function probeAllPricing(
  providers: ProviderConfig[],
  model: string,
  cache: RequirementsCache,
  paymentBackend: PaymentBackend,
  timeoutMs = 2000,
): Promise<Map<string, number | null>> {
  const results = new Map<string, number | null>();

  // Check cache first
  const toProbe: ProviderConfig[] = [];
  for (const provider of providers) {
    const probePath = probePathForFormat(provider.api_format, model);
    const cacheKey = RequirementsCache.buildKey(provider, probePath);

    if (cache.isNegativeCached(cacheKey)) {
      results.set(provider.id, null);
      continue;
    }

    const cached = cache.get(cacheKey);
    if (cached) {
      const price = Number(cached.maxAmountRequired);
      results.set(provider.id, isNaN(price) ? null : price);
      continue;
    }

    toProbe.push(provider);
  }

  if (toProbe.length === 0) return results;

  // Probe remaining providers in parallel with timeout
  const probePromises = toProbe.map(async (provider) => {
    const result = await probeProviderPricing(provider, model, paymentBackend);
    const probePath = probePathForFormat(provider.api_format, model);
    const cacheKey = RequirementsCache.buildKey(provider, probePath);

    if (result.price !== null) {
      cache.set(cacheKey, {
        maxAmountRequired: String(result.price),
        ttl: provider.dynamic_pricing ? 30 : 300,
        cachedAt: Date.now(),
        dynamicPricing: provider.dynamic_pricing,
      });
    } else {
      cache.setNegative(cacheKey);
    }

    return result;
  });

  const timeoutPromise = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), timeoutMs),
  );

  const settled = await Promise.race([
    Promise.allSettled(probePromises),
    timeoutPromise,
  ]);

  if (settled === 'timeout') {
    logger.warn('Pricing probes timed out', { timeoutMs, pendingCount: toProbe.length });
    // Set null for providers that didn't complete
    for (const provider of toProbe) {
      if (!results.has(provider.id)) {
        results.set(provider.id, null);
      }
    }
  } else {
    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        results.set(outcome.value.providerId, outcome.value.price);
      }
    }
    // Fill in any missing (rejected) results
    for (const provider of toProbe) {
      if (!results.has(provider.id)) {
        results.set(provider.id, null);
      }
    }
  }

  return results;
}

/**
 * Sort providers cheapest-first using cached prices.
 * Primary: price ascending. Tiebreaker: priority ascending.
 * Providers without a price go last, sorted by priority.
 */
export function sortProvidersByPrice(
  providers: ProviderConfig[],
  prices: Map<string, number | null>,
): ProviderConfig[] {
  return [...providers].sort((a, b) => {
    const priceA = prices.get(a.id) ?? null;
    const priceB = prices.get(b.id) ?? null;

    // Both have prices: sort by price, then priority
    if (priceA !== null && priceB !== null) {
      if (priceA !== priceB) return priceA - priceB;
      return a.priority - b.priority;
    }

    // One has price, other doesn't: priced one first
    if (priceA !== null) return -1;
    if (priceB !== null) return 1;

    // Neither has price: sort by priority
    return a.priority - b.priority;
  });
}
