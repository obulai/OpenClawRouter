import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { checkBalance, BalanceMonitor } from '../balance.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function mockRpcResponse(balanceHex: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ result: balanceHex }),
  };
}

function mockRpcError(message: string) {
  return {
    ok: true,
    json: () => Promise.resolve({ error: { message } }),
  };
}

describe('checkBalance', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns balance info for a valid response', async () => {
    // 10 USDC = 10_000_000 atomic units = 0x989680
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x989680'));

    const result = await checkBalance('0x1234', 'base', 'http://localhost:8545');

    expect(result.balanceRaw).toBe(BigInt(10_000_000));
    expect(result.balanceUSDC).toBe(10);
    expect(result.address).toBe('0x1234');
    expect(result.network).toBe('base');
    expect(result.checkedAt).toBeGreaterThan(0);
  });

  it('constructs the correct ERC-20 balanceOf call', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0xAbCdEf1234567890AbCdEf1234567890AbCdEf12', 'base', 'http://rpc.test');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('http://rpc.test');

    const body = JSON.parse(options.body);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('eth_call');
    // Should contain the balanceOf selector (0x70a08231) + padded address
    expect(body.params[0].data).toMatch(/^0x70a08231/);
    expect(body.params[0].data).toContain('abcdef1234567890abcdef1234567890abcdef12');
    expect(body.params[1]).toBe('latest');
  });

  it('uses Base mainnet USDC address for "base" network', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0x1234', 'base', 'http://rpc.test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params[0].to).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('uses Base Sepolia USDC address for "base-sepolia" network', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0x1234', 'base-sepolia', 'http://rpc.test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params[0].to).toBe('0x036CbD53842c5426634e7929541eC2318f3dCF7e');
  });

  it('defaults to Base mainnet USDC for unknown networks', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0x1234', 'polygon', 'http://rpc.test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.params[0].to).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
  });

  it('handles zero balance', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    const result = await checkBalance('0x1234', 'base', 'http://rpc.test');

    expect(result.balanceRaw).toBe(BigInt(0));
    expect(result.balanceUSDC).toBe(0);
  });

  it('handles null/undefined result as zero balance', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: undefined }),
    });

    const result = await checkBalance('0x1234', 'base', 'http://rpc.test');
    expect(result.balanceRaw).toBe(BigInt(0));
    expect(result.balanceUSDC).toBe(0);
  });

  it('converts large balances correctly', async () => {
    // 1,000,000 USDC = 1_000_000_000_000 atomic units
    const largeHex = '0x' + (1_000_000_000_000n).toString(16);
    mockFetch.mockResolvedValueOnce(mockRpcResponse(largeHex));

    const result = await checkBalance('0x1234', 'base', 'http://rpc.test');
    expect(result.balanceUSDC).toBe(1_000_000);
  });

  it('pads address to 32 bytes', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0xABCD', 'base', 'http://rpc.test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const data = body.params[0].data;
    // Selector (10 chars) + 64-char padded address = 74 chars total
    expect(data.length).toBe(74);
    expect(data).toMatch(/^0x70a082310{60}abcd$/);
  });

  it('throws on RPC error response', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcError('execution reverted'));

    await expect(
      checkBalance('0x1234', 'base', 'http://rpc.test'),
    ).rejects.toThrow('RPC error: execution reverted');
  });

  it('throws on fetch failure', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network timeout'));

    await expect(
      checkBalance('0x1234', 'base', 'http://rpc.test'),
    ).rejects.toThrow('network timeout');
  });

  it('throws for unknown network without rpcUrl', async () => {
    await expect(
      checkBalance('0x1234', 'unknown-network'),
    ).rejects.toThrow('No RPC endpoint configured for network');
  });

  it('uses default RPC for "base" network when no rpcUrl provided', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0x1234', 'base');

    expect(mockFetch.mock.calls[0][0]).toBe('https://mainnet.base.org');
  });

  it('uses default RPC for "base-sepolia" network when no rpcUrl provided', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0x1234', 'base-sepolia');

    expect(mockFetch.mock.calls[0][0]).toBe('https://sepolia.base.org');
  });

  it('sends POST request with correct content-type', async () => {
    mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

    await checkBalance('0x1234', 'base', 'http://rpc.test');

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });
});

describe('BalanceMonitor', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getBalance', () => {
    it('fetches balance on first call', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x989680'));

      const monitor = new BalanceMonitor(60_000);
      const result = await monitor.getBalance('0x1234', 'base', 'http://rpc.test');

      expect(result.balanceUSDC).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('returns cached result on subsequent calls within TTL', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x989680'));

      const monitor = new BalanceMonitor(60_000);
      await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      const result = await monitor.getBalance('0x1234', 'base', 'http://rpc.test');

      expect(result.balanceUSDC).toBe(10);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('refetches after cache TTL expires', async () => {
      mockFetch
        .mockResolvedValueOnce(mockRpcResponse('0x989680'))   // 10 USDC
        .mockResolvedValueOnce(mockRpcResponse('0x1312d00')); // 20 USDC

      const monitor = new BalanceMonitor(100); // 100ms TTL

      const first = await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      expect(first.balanceUSDC).toBe(10);

      // Advance time past TTL
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 200);

      const second = await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      expect(second.balanceUSDC).toBe(20);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('refetches when address changes', async () => {
      mockFetch
        .mockResolvedValueOnce(mockRpcResponse('0x989680'))
        .mockResolvedValueOnce(mockRpcResponse('0x0'));

      const monitor = new BalanceMonitor(60_000);
      await monitor.getBalance('0xAddr1', 'base', 'http://rpc.test');
      const result = await monitor.getBalance('0xAddr2', 'base', 'http://rpc.test');

      expect(result.address).toBe('0xAddr2');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('refetches when network changes', async () => {
      mockFetch
        .mockResolvedValueOnce(mockRpcResponse('0x989680'))
        .mockResolvedValueOnce(mockRpcResponse('0x0'));

      const monitor = new BalanceMonitor(60_000);
      await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      const result = await monitor.getBalance('0x1234', 'base-sepolia', 'http://rpc.test');

      expect(result.network).toBe('base-sepolia');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('hasSufficientBalance', () => {
    it('returns true when balance exceeds the required amount', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x989680')); // 10 USDC

      const monitor = new BalanceMonitor();
      const result = await monitor.hasSufficientBalance(
        '0x1234',
        BigInt(5_000_000), // 5 USDC
        'base',
        'http://rpc.test',
      );

      expect(result).toBe(true);
    });

    it('returns true when balance equals the required amount', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x989680')); // 10 USDC

      const monitor = new BalanceMonitor();
      const result = await monitor.hasSufficientBalance(
        '0x1234',
        BigInt(10_000_000),
        'base',
        'http://rpc.test',
      );

      expect(result).toBe(true);
    });

    it('returns false when balance is insufficient', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x989680')); // 10 USDC

      const monitor = new BalanceMonitor();
      const result = await monitor.hasSufficientBalance(
        '0x1234',
        BigInt(20_000_000), // 20 USDC
        'base',
        'http://rpc.test',
      );

      expect(result).toBe(false);
    });

    it('returns false when balance is zero', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

      const monitor = new BalanceMonitor();
      const result = await monitor.hasSufficientBalance(
        '0x1234',
        BigInt(1),
        'base',
        'http://rpc.test',
      );

      expect(result).toBe(false);
    });

    it('uses cached balance from previous getBalance call', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x989680')); // 10 USDC

      const monitor = new BalanceMonitor(60_000);
      await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      const result = await monitor.hasSufficientBalance(
        '0x1234',
        BigInt(5_000_000),
        'base',
        'http://rpc.test',
      );

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional fetch
    });
  });

  describe('invalidate', () => {
    it('forces a refetch on next getBalance call', async () => {
      mockFetch
        .mockResolvedValueOnce(mockRpcResponse('0x989680'))   // 10 USDC
        .mockResolvedValueOnce(mockRpcResponse('0x1312d00')); // 20 USDC

      const monitor = new BalanceMonitor(60_000);
      const first = await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      expect(first.balanceUSDC).toBe(10);

      monitor.invalidate();

      const second = await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      expect(second.balanceUSDC).toBe(20);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('can be called multiple times without error', () => {
      const monitor = new BalanceMonitor();
      monitor.invalidate();
      monitor.invalidate();
      // Should not throw
    });
  });

  describe('constructor', () => {
    it('uses default TTL when not specified', async () => {
      mockFetch.mockResolvedValueOnce(mockRpcResponse('0x0'));

      const monitor = new BalanceMonitor();
      await monitor.getBalance('0x1234', 'base', 'http://rpc.test');
      // Subsequent call within default TTL should use cache
      const result = await monitor.getBalance('0x1234', 'base', 'http://rpc.test');

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
