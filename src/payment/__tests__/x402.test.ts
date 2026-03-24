import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  parseRequirements,
  selectPaymentOption,
  buildPaymentHeader,
  handleX402Payment,
} from '../x402.js';
import type { PaymentAccept } from '../x402.js';
import type { ProviderResponse } from '../../types.js';

function make402Response(body: unknown, headers: Record<string, string> = {}): ProviderResponse {
  return {
    status: 402,
    headers: { 'content-type': 'application/json', ...headers },
    body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

const baseMainnetOption: PaymentAccept = {
  scheme: 'exact',
  network: 'base',
  maxAmountRequired: '1000000',
  resource: '0xrecipient',
};

const baseSepoliaOption: PaymentAccept = {
  scheme: 'exact',
  network: 'base-sepolia',
  maxAmountRequired: '500000',
  resource: '0xrecipient',
};

const otherExactOption: PaymentAccept = {
  scheme: 'exact',
  network: 'ethereum',
  maxAmountRequired: '2000000',
  resource: '0xrecipient',
};

const nonExactOption: PaymentAccept = {
  scheme: 'stream',
  network: 'base',
  maxAmountRequired: '100000',
  resource: '0xrecipient',
};

describe('parseRequirements', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('from body JSON', () => {
    it('parses direct accepts array', () => {
      const response = make402Response({ accepts: [baseMainnetOption] });
      const result = parseRequirements(response);
      expect(result).not.toBeNull();
      expect(result!.accepts).toHaveLength(1);
      expect(result!.accepts[0].network).toBe('base');
      expect(result!.accepts[0].maxAmountRequired).toBe('1000000');
    });

    it('parses multiple accepts', () => {
      const response = make402Response({
        accepts: [baseMainnetOption, baseSepoliaOption, otherExactOption],
      });
      const result = parseRequirements(response);
      expect(result).not.toBeNull();
      expect(result!.accepts).toHaveLength(3);
    });

    it('parses wrapped paymentRequirements.accepts', () => {
      const response = make402Response({
        paymentRequirements: { accepts: [baseSepoliaOption] },
      });
      const result = parseRequirements(response);
      expect(result).not.toBeNull();
      expect(result!.accepts[0].network).toBe('base-sepolia');
    });

    it('parses single top-level requirement object', () => {
      const response = make402Response({
        scheme: 'exact',
        network: 'base',
        maxAmountRequired: '1000000',
        resource: '0xrecipient',
      });
      const result = parseRequirements(response);
      expect(result).not.toBeNull();
      expect(result!.accepts).toHaveLength(1);
      expect(result!.accepts[0].maxAmountRequired).toBe('1000000');
    });

    it('returns null for empty accepts array', () => {
      const response = make402Response({ accepts: [] });
      const result = parseRequirements(response);
      expect(result).toBeNull();
    });

    it('returns null for body with no payment info', () => {
      const response = make402Response({ message: 'payment required' });
      const result = parseRequirements(response);
      expect(result).toBeNull();
    });
  });

  describe('from headers', () => {
    it('parses x-payment header with array', () => {
      const response = make402Response('not json', {
        'x-payment': JSON.stringify([baseMainnetOption]),
      });
      const result = parseRequirements(response);
      expect(result).not.toBeNull();
      expect(result!.accepts).toHaveLength(1);
    });

    it('parses X-Payment header (capitalized) with accepts object', () => {
      const response = make402Response('not json', {
        'X-Payment': JSON.stringify({ accepts: [baseSepoliaOption] }),
      });
      const result = parseRequirements(response);
      expect(result).not.toBeNull();
      expect(result!.accepts[0].network).toBe('base-sepolia');
    });

    it('returns null for unparseable header', () => {
      const response = make402Response('not json', {
        'x-payment': 'not json either',
      });
      const result = parseRequirements(response);
      expect(result).toBeNull();
    });

    it('returns null for non-JSON body without payment headers', () => {
      const response: ProviderResponse = {
        status: 402,
        headers: {},
        body: Buffer.from('Payment Required'),
      };
      const result = parseRequirements(response);
      expect(result).toBeNull();
    });
  });
});

describe('selectPaymentOption', () => {
  it('prefers Base mainnet with exact scheme', () => {
    const result = selectPaymentOption({
      accepts: [otherExactOption, baseSepoliaOption, baseMainnetOption],
    });
    expect(result).toBe(baseMainnetOption);
  });

  it('falls back to Base Sepolia when no mainnet exact', () => {
    const result = selectPaymentOption({
      accepts: [otherExactOption, baseSepoliaOption],
    });
    expect(result).toBe(baseSepoliaOption);
  });

  it('does not match Base mainnet without exact scheme', () => {
    const result = selectPaymentOption({
      accepts: [nonExactOption, baseSepoliaOption],
    });
    // nonExactOption has network=base but scheme=stream, so it should prefer baseSepoliaOption
    expect(result).toBe(baseSepoliaOption);
  });

  it('falls back to any exact scheme when no Base networks', () => {
    const result = selectPaymentOption({
      accepts: [nonExactOption, otherExactOption],
    });
    expect(result).toBe(otherExactOption);
  });

  it('falls back to first option when no exact scheme exists', () => {
    const result = selectPaymentOption({
      accepts: [nonExactOption],
    });
    expect(result).toBe(nonExactOption);
  });

  it('returns null for empty accepts', () => {
    const result = selectPaymentOption({ accepts: [] });
    expect(result).toBeNull();
  });

  it('returns the only option when there is exactly one', () => {
    const result = selectPaymentOption({ accepts: [baseMainnetOption] });
    expect(result).toBe(baseMainnetOption);
  });
});

describe('buildPaymentHeader', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a base64-encoded string containing the payment payload', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0xab, 0xcd]));

    const result = await buildPaymentHeader(baseMainnetOption, '0xSigner', signFn);

    const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
    expect(decoded.x402Version).toBe(1);
    expect(decoded.scheme).toBe('exact');
    expect(decoded.network).toBe('base');
    expect(decoded.payload.authorization.from).toBe('0xSigner');
    expect(decoded.payload.authorization.to).toBe('0xrecipient');
    expect(decoded.payload.authorization.value).toBe('1000000');
    expect(decoded.payload.signature).toMatch(/^0x/);
  });

  it('calls signFn with the authorization message as Uint8Array', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0x01]));

    await buildPaymentHeader(baseMainnetOption, '0xSigner', signFn);

    expect(signFn).toHaveBeenCalledTimes(1);
    expect(signFn).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it('encodes the signature as hex with 0x prefix', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));

    const result = await buildPaymentHeader(baseMainnetOption, '0xSigner', signFn);
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString());

    expect(decoded.payload.signature).toBe('0xdeadbeef');
  });

  it('sets validAfter to "0"', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0x01]));

    const result = await buildPaymentHeader(baseMainnetOption, '0xSigner', signFn);
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString());

    expect(decoded.payload.authorization.validAfter).toBe('0');
  });

  it('sets validBefore to approximately 1 hour from now', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0x01]));
    const now = Math.floor(Date.now() / 1000);

    const result = await buildPaymentHeader(baseMainnetOption, '0xSigner', signFn);
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString());
    const validBefore = Number(decoded.payload.authorization.validBefore);

    expect(validBefore).toBeGreaterThanOrEqual(now + 3595);
    expect(validBefore).toBeLessThanOrEqual(now + 3605);
  });

  it('includes a nonce in the authorization', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0x01]));

    const result = await buildPaymentHeader(baseMainnetOption, '0xSigner', signFn);
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString());

    expect(decoded.payload.authorization.nonce).toBeTruthy();
    expect(typeof decoded.payload.authorization.nonce).toBe('string');
  });

  it('throws PaymentError when signFn fails', async () => {
    const signFn = vi.fn().mockRejectedValue(new Error('signing failed'));

    await expect(
      buildPaymentHeader(baseMainnetOption, '0xSigner', signFn),
    ).rejects.toThrow('Failed to sign payment');
  });

  it('includes non-Error rejection messages', async () => {
    const signFn = vi.fn().mockRejectedValue('string error');

    await expect(
      buildPaymentHeader(baseMainnetOption, '0xSigner', signFn),
    ).rejects.toThrow('Failed to sign payment: string error');
  });

  it('uses the correct scheme and network from the option', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0x01]));

    const result = await buildPaymentHeader(baseSepoliaOption, '0xSigner', signFn);
    const decoded = JSON.parse(Buffer.from(result, 'base64').toString());

    expect(decoded.scheme).toBe('exact');
    expect(decoded.network).toBe('base-sepolia');
    expect(decoded.payload.authorization.value).toBe('500000');
  });
});

describe('handleX402Payment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns payment header and selected option for valid 402', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0x01]));
    const response = make402Response({ accepts: [baseMainnetOption] });

    const result = await handleX402Payment(response, '0xSigner', signFn);

    expect(result.paymentHeader).toBeTruthy();
    expect(typeof result.paymentHeader).toBe('string');
    expect(result.option.network).toBe('base');
    expect(result.option.scheme).toBe('exact');
  });

  it('throws PaymentError when requirements cannot be parsed', async () => {
    const signFn = vi.fn();
    const response: ProviderResponse = {
      status: 402,
      headers: {},
      body: Buffer.from('not json'),
    };

    await expect(
      handleX402Payment(response, '0xSigner', signFn),
    ).rejects.toThrow('Could not parse payment requirements');
  });

  it('throws PaymentError when accepts array is empty', async () => {
    const signFn = vi.fn();
    const response = make402Response({ accepts: [] });

    await expect(
      handleX402Payment(response, '0xSigner', signFn),
    ).rejects.toThrow('Could not parse payment requirements');
  });

  it('selects the best payment option from multiple', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0x01]));
    const response = make402Response({
      accepts: [baseSepoliaOption, baseMainnetOption, otherExactOption],
    });

    const result = await handleX402Payment(response, '0xSigner', signFn);
    expect(result.option.network).toBe('base');
  });

  it('propagates sign errors as PaymentError', async () => {
    const signFn = vi.fn().mockRejectedValue(new Error('hw wallet disconnected'));
    const response = make402Response({ accepts: [baseMainnetOption] });

    await expect(
      handleX402Payment(response, '0xSigner', signFn),
    ).rejects.toThrow('Failed to sign payment');
  });

  it('returns a decodable payment header', async () => {
    const signFn = vi.fn().mockResolvedValue(new Uint8Array([0xaa, 0xbb]));
    const response = make402Response({ accepts: [baseMainnetOption] });

    const { paymentHeader } = await handleX402Payment(response, '0xWallet', signFn);

    const decoded = JSON.parse(Buffer.from(paymentHeader, 'base64').toString());
    expect(decoded.x402Version).toBe(1);
    expect(decoded.payload.authorization.from).toBe('0xWallet');
  });
});
