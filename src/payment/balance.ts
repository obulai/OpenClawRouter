/**
 * EVM balance monitoring for wallet mode.
 *
 * Checks USDC balance on Base chain to warn users before they run out
 * of funds. Caches balance to avoid excessive RPC calls.
 */

import { logger } from '../logger.js';

/** Base mainnet USDC contract */
const BASE_USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
/** Base Sepolia USDC contract */
const BASE_SEPOLIA_USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

/** Default RPC endpoints */
const RPC_ENDPOINTS: Record<string, string> = {
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org',
};

/** Balance check result */
export interface BalanceInfo {
  /** USDC balance in atomic units (6 decimals) */
  balanceRaw: bigint;
  /** USDC balance as a human-readable number */
  balanceUSDC: number;
  /** The wallet address */
  address: string;
  /** Network checked */
  network: string;
  /** When this was last checked */
  checkedAt: number;
}

/** Low balance threshold in USDC (warn below this) */
const LOW_BALANCE_THRESHOLD = 1.0;

/**
 * Get the USDC contract address for a given network.
 */
function getUSDCAddress(network: string): string {
  switch (network) {
    case 'base':
      return BASE_USDC_ADDRESS;
    case 'base-sepolia':
      return BASE_SEPOLIA_USDC_ADDRESS;
    default:
      return BASE_USDC_ADDRESS;
  }
}

/**
 * Check USDC balance for an address on a given network.
 * Uses the ERC-20 balanceOf(address) call via eth_call.
 */
export async function checkBalance(
  address: string,
  network: string = 'base',
  rpcUrl?: string,
): Promise<BalanceInfo> {
  const rpc = rpcUrl ?? RPC_ENDPOINTS[network];
  if (!rpc) {
    throw new Error(`No RPC endpoint configured for network: ${network}`);
  }

  const usdcAddress = getUSDCAddress(network);

  // ERC-20 balanceOf(address) selector: 0x70a08231
  // Pad address to 32 bytes
  const paddedAddress = address.toLowerCase().replace('0x', '').padStart(64, '0');
  const data = `0x70a08231${paddedAddress}`;

  try {
    const response = await fetch(rpc, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_call',
        params: [{ to: usdcAddress, data }, 'latest'],
      }),
    });

    const result = await response.json() as { result?: string; error?: { message: string } };

    if (result.error) {
      throw new Error(`RPC error: ${result.error.message}`);
    }

    const balanceHex = result.result ?? '0x0';
    const balanceRaw = BigInt(balanceHex);
    const balanceUSDC = Number(balanceRaw) / 1e6; // USDC has 6 decimals

    const info: BalanceInfo = {
      balanceRaw,
      balanceUSDC,
      address,
      network,
      checkedAt: Date.now(),
    };

    if (balanceUSDC < LOW_BALANCE_THRESHOLD) {
      logger.warn('Low USDC balance', {
        address,
        balance: balanceUSDC.toFixed(6),
        network,
      });
    }

    return info;
  } catch (err) {
    logger.error('Failed to check balance', {
      address,
      network,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Cached balance checker that avoids excessive RPC calls.
 */
export class BalanceMonitor {
  private cached: BalanceInfo | null = null;
  private cacheTtlMs: number;

  constructor(cacheTtlMs: number = 60_000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Get balance, using cache if fresh.
   */
  async getBalance(
    address: string,
    network: string = 'base',
    rpcUrl?: string,
  ): Promise<BalanceInfo> {
    if (
      this.cached &&
      this.cached.address === address &&
      this.cached.network === network &&
      Date.now() - this.cached.checkedAt < this.cacheTtlMs
    ) {
      return this.cached;
    }

    this.cached = await checkBalance(address, network, rpcUrl);
    return this.cached;
  }

  /**
   * Check if balance is sufficient for a given amount (in USDC atomic units).
   */
  async hasSufficientBalance(
    address: string,
    amountRaw: bigint,
    network: string = 'base',
    rpcUrl?: string,
  ): Promise<boolean> {
    const info = await this.getBalance(address, network, rpcUrl);
    return info.balanceRaw >= amountRaw;
  }

  /** Clear the cached balance. */
  invalidate(): void {
    this.cached = null;
  }
}
