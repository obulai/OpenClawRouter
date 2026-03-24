/**
 * x402 payment protocol flow for wallet mode.
 *
 * Implements the client-side x402 flow:
 * 1. Send request to provider → get 402 with payment requirements
 * 2. Parse requirements (accepts array with network, amount, recipient)
 * 3. Build and sign EVM payment transaction
 * 4. Retry request with X-PAYMENT header containing signed payment
 *
 * Uses @x402/evm for payment header construction when available,
 * with a manual fallback for basic USDC transfers on Base.
 */

import type { ProviderResponse } from '../types.js';
import { PaymentError } from '../errors.js';
import { logger } from '../logger.js';

/** Parsed x402 payment requirements from a 402 response. */
export interface PaymentRequirements {
  /** Accepted payment schemes */
  accepts: PaymentAccept[];
}

export interface PaymentAccept {
  /** Payment scheme (e.g., "exact") */
  scheme: string;
  /** Network identifier (e.g., "base-sepolia", "base") */
  network: string;
  /** Maximum amount required in smallest unit (e.g., USDC atomic units) */
  maxAmountRequired: string;
  /** Recipient address */
  resource: string;
  /** Token contract address (USDC on Base) */
  extra?: {
    /** ERC-20 token address */
    token?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Parse x402 payment requirements from a 402 response.
 */
export function parseRequirements(response: ProviderResponse): PaymentRequirements | null {
  // Try body first (most providers put it here)
  try {
    const parsed = JSON.parse(response.body.toString());

    // Direct accepts array
    if (Array.isArray(parsed.accepts) && parsed.accepts.length > 0) {
      return { accepts: parsed.accepts };
    }

    // Some providers wrap in a different shape
    if (parsed.paymentRequirements && Array.isArray(parsed.paymentRequirements.accepts)) {
      return { accepts: parsed.paymentRequirements.accepts };
    }

    // Single requirement as top-level object
    if (parsed.maxAmountRequired && parsed.network) {
      return { accepts: [parsed as PaymentAccept] };
    }
  } catch {
    // Not JSON body, try headers
  }

  // Try X-PAYMENT header (some providers use this)
  const paymentHeader = response.headers['x-payment'] ?? response.headers['X-Payment'];
  if (paymentHeader) {
    try {
      const parsed = JSON.parse(paymentHeader);
      if (Array.isArray(parsed)) {
        return { accepts: parsed };
      }
      if (parsed.accepts) {
        return { accepts: parsed.accepts };
      }
    } catch {
      // Not parseable
    }
  }

  return null;
}

/**
 * Select the best payment option from requirements.
 * Prefers Base network, EVM chains, and exact scheme.
 */
export function selectPaymentOption(requirements: PaymentRequirements): PaymentAccept | null {
  const { accepts } = requirements;
  if (accepts.length === 0) return null;

  // Prefer Base mainnet
  const base = accepts.find((a) => a.network === 'base' && a.scheme === 'exact');
  if (base) return base;

  // Fallback to Base testnet
  const baseSepolia = accepts.find((a) => a.network === 'base-sepolia' && a.scheme === 'exact');
  if (baseSepolia) return baseSepolia;

  // Any EVM exact scheme
  const anyExact = accepts.find((a) => a.scheme === 'exact');
  if (anyExact) return anyExact;

  // Last resort: first option
  return accepts[0];
}

/**
 * Build the x402 payment header value.
 *
 * This creates a signed payment that can be included in the X-PAYMENT header
 * to authorize the provider to pull funds.
 *
 * @param option - The selected payment option from requirements
 * @param signerAddress - The wallet address that will sign
 * @param signFn - Function that signs a message hash and returns the signature
 * @returns Base64-encoded payment header value
 */
export async function buildPaymentHeader(
  option: PaymentAccept,
  signerAddress: string,
  signFn: (hash: Uint8Array) => Promise<Uint8Array>,
): Promise<string> {
  // Build the payment payload per x402 spec
  const payload = {
    x402Version: 1,
    scheme: option.scheme,
    network: option.network,
    payload: {
      signature: '',
      authorization: {
        from: signerAddress,
        to: option.resource,
        value: option.maxAmountRequired,
        validAfter: '0',
        validBefore: String(Math.floor(Date.now() / 1000) + 3600), // 1 hour validity
        nonce: crypto.randomUUID().replace(/-/g, '').slice(0, 32),
      },
    },
  };

  // Sign the authorization
  const message = JSON.stringify(payload.payload.authorization);
  const encoder = new TextEncoder();
  const messageHash = encoder.encode(message);

  try {
    const signature = await signFn(messageHash);
    payload.payload.signature = '0x' + Buffer.from(signature).toString('hex');
  } catch (err) {
    throw new PaymentError(
      `Failed to sign payment: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Base64 encode the full payload
  const paymentJson = JSON.stringify(payload);
  return Buffer.from(paymentJson).toString('base64');

}

/**
 * Execute the full x402 payment flow:
 * 1. Parse 402 requirements
 * 2. Select best payment option
 * 3. Build signed payment header
 * 4. Return the header value to include in retry
 */
export async function handleX402Payment(
  response402: ProviderResponse,
  signerAddress: string,
  signFn: (hash: Uint8Array) => Promise<Uint8Array>,
): Promise<{ paymentHeader: string; option: PaymentAccept }> {
  const requirements = parseRequirements(response402);
  if (!requirements) {
    throw new PaymentError('Could not parse payment requirements from 402 response');
  }

  const option = selectPaymentOption(requirements);
  if (!option) {
    throw new PaymentError('No compatible payment option found in requirements');
  }

  logger.debug('Selected payment option', {
    scheme: option.scheme,
    network: option.network,
    amount: option.maxAmountRequired,
    recipient: option.resource,
  });

  const paymentHeader = await buildPaymentHeader(option, signerAddress, signFn);

  return { paymentHeader, option };
}
