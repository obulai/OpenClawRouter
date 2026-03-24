import type { ProviderConfig, PaymentBackend, ProviderResponse, TranslateContext } from '../types.js';
import { translateRequest, translateResponse } from './translate/index.js';
import { logger } from '../logger.js';

const MAX_FAILOVER_ATTEMPTS = 3;

export interface FailoverResult {
  response: ProviderResponse;
  provider: ProviderConfig;
  failoverCount: number;
}

/**
 * Classify whether an error is retryable (try next provider) or terminal (return to client).
 * 5xx and 429 are retryable; other 4xx are terminal.
 */
export function isRetryableError(status: number): boolean {
  return status >= 500 || status === 429;
}

/**
 * Build the full URL for a provider request.
 * If pathOverride is provided (from translation), it replaces the clientPath.
 */
export function buildProviderUrl(
  provider: ProviderConfig,
  clientPath: string,
  pathOverride?: string,
): string {
  const path = pathOverride ?? clientPath;
  return `${provider.scheme}://${provider.host}${provider.path_prefix}${path}`;
}

/**
 * Execute the failover loop.
 *
 * Iterates providers (up to 1 + MAX_FAILOVER_ATTEMPTS = 4 total):
 * 1. Skip negative-cached providers
 * 2. Translate request for provider format
 * 3. Send via payment backend
 * 4. On success (2xx): translate response back, return
 * 5. On retryable error (5xx, 429): save as lastError, try next
 * 6. On terminal error (4xx except 429): return immediately
 * 7. If all exhausted: return lastError or 502
 */
export async function executeWithFailover(params: {
  providers: ProviderConfig[];
  categoryId: string;
  model: string;
  clientPath: string;
  method: string;
  headers: Record<string, string>;
  body: Buffer;
  stream: boolean;
  paymentBackend: PaymentBackend;
  isNegativeCached?: (providerId: string) => boolean;
}): Promise<FailoverResult> {
  const {
    providers,
    categoryId,
    model,
    clientPath,
    method,
    headers,
    body,
    stream,
    paymentBackend,
    isNegativeCached,
  } = params;

  const maxAttempts = 1 + MAX_FAILOVER_ATTEMPTS;
  let lastError: ProviderResponse | undefined;
  let lastProvider: ProviderConfig | undefined;
  let failoverCount = 0;
  let attempted = 0;

  for (const provider of providers) {
    if (attempted >= maxAttempts) break;

    // Skip negative-cached providers
    if (isNegativeCached?.(provider.id)) {
      logger.debug('Skipping negative-cached provider', { providerId: provider.id });
      continue;
    }

    attempted++;
    if (attempted > 1) failoverCount++;

    const ctx: TranslateContext = {
      format: provider.api_format,
      categoryId,
      model,
      clientPath,
    };

    try {
      // Translate request for this provider's format
      const translated = translateRequest(ctx, body);

      // Build URL with possible path override from translation
      const url = buildProviderUrl(provider, clientPath, translated.pathOverride);

      logger.debug('Sending request to provider', {
        providerId: provider.id,
        url,
        attempt: attempted,
      });

      // Send request
      const response = await paymentBackend.sendRequest({
        provider,
        url,
        method,
        headers: { ...headers, ...provider.headers },
        body: translated.body,
        stream: stream && !translated.stripStreaming,
      });

      // Success (2xx)
      if (response.status >= 200 && response.status < 300) {
        const translatedBody = translateResponse(ctx, response.body, response.status);
        return {
          response: { ...response, body: translatedBody },
          provider,
          failoverCount,
        };
      }

      // Terminal error (4xx except 429)
      if (!isRetryableError(response.status)) {
        logger.warn('Terminal error from provider', {
          providerId: provider.id,
          status: response.status,
        });
        return { response, provider, failoverCount };
      }

      // Retryable error — save and continue
      logger.warn('Retryable error from provider, failing over', {
        providerId: provider.id,
        status: response.status,
      });
      lastError = response;
      lastProvider = provider;
    } catch (err) {
      // Network/transport errors are retryable
      logger.error('Provider request failed with exception', {
        providerId: provider.id,
        error: err instanceof Error ? err.message : String(err),
      });
      lastError = {
        status: 502,
        headers: {},
        body: Buffer.from(
          JSON.stringify({ error: { message: 'Provider unavailable', type: 'proxy_error' } }),
        ),
      };
      lastProvider = provider;
    }
  }

  // All providers exhausted
  if (lastError && lastProvider) {
    return { response: lastError, provider: lastProvider, failoverCount };
  }

  // No providers available at all
  const emptyResponse: ProviderResponse = {
    status: 502,
    headers: {},
    body: Buffer.from(
      JSON.stringify({
        error: { message: 'No providers available', type: 'proxy_error' },
      }),
    ),
  };

  // Return a synthetic provider for the empty case
  const syntheticProvider: ProviderConfig = {
    id: 'none',
    name: 'none',
    scheme: 'https',
    host: 'localhost',
    path_prefix: '',
    api_format: 'openai',
    priority: 999,
    enabled: false,
    dynamic_pricing: false,
    headers: {},
  };

  return { response: emptyResponse, provider: syntheticProvider, failoverCount };
}
