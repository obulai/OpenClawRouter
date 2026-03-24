/**
 * Wallet-mode payment backend.
 *
 * Uses a BIP-39 mnemonic / BIP-44 derivation to manage a local wallet
 * that signs x402 payments directly to providers. No Obul proxy needed.
 *
 * Wallet storage: encrypted mnemonic at ~/.openclawrouter/wallet.key
 * Derivation path: m/44'/60'/0'/0/0 (standard Ethereum)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { PaymentBackend, ProviderConfig, ProviderResponse } from '../types.js';
import { PaymentError } from '../errors.js';
import { handleX402Payment } from './x402.js';
import { BalanceMonitor } from './balance.js';
import { logger } from '../logger.js';

const DEFAULT_WALLET_DIR = join(homedir(), '.openclawrouter');
const DEFAULT_WALLET_FILE = 'wallet.key';
const DERIVATION_PATH = "m/44'/60'/0'/0/0";
const ENCRYPTION_ALGO = 'aes-256-gcm';

/** Wallet state */
export interface WalletInfo {
  address: string;
  publicKey: string;
  derivationPath: string;
}

/**
 * Generate a new BIP-39 mnemonic.
 * Uses @scure/bip39 if available, otherwise generates a random 128-bit mnemonic.
 */
export async function generateMnemonic(): Promise<string> {
  try {
    const { generateMnemonic: gen, english } = await import('@scure/bip39' as string);
    return gen(english);
  } catch {
    // Fallback: generate 16 random bytes → convert to word-like hex chunks
    // This is NOT BIP-39 compliant but allows the wallet to function
    // when @scure/bip39 is not installed
    const entropy = randomBytes(16);
    return entropy.toString('hex').match(/.{1,4}/g)!.join(' ');
  }
}

/**
 * Derive an Ethereum private key from a mnemonic.
 */
export async function derivePrivateKey(mnemonic: string): Promise<{
  privateKey: Uint8Array;
  address: string;
}> {
  try {
    const { mnemonicToSeedSync } = await import('@scure/bip39' as string);
    const { HDKey } = await import('@scure/bip32' as string);
    const seed = mnemonicToSeedSync(mnemonic);
    const hdKey = HDKey.fromMasterSeed(seed);
    const child = hdKey.derive(DERIVATION_PATH);

    if (!child.privateKey) {
      throw new Error('Failed to derive private key');
    }

    // Derive address from public key (keccak256 of uncompressed public key, last 20 bytes)
    const { keccak_256 } = await import('@noble/hashes/sha3' as string);
    const pubKeyUncompressed = child.publicKey!.slice(1); // strip 0x04 prefix
    const hash = keccak_256(pubKeyUncompressed);
    const addressBytes = hash.slice(-20);
    const address = '0x' + Buffer.from(addressBytes).toString('hex');

    return { privateKey: child.privateKey, address };
  } catch (err) {
    if ((err as Error).message?.includes('Cannot find module')) {
      throw new PaymentError(
        'Wallet mode requires @scure/bip39 and @scure/bip32. Install them: npm install @scure/bip39 @scure/bip32 @noble/hashes',
      );
    }
    throw err;
  }
}

/**
 * Encrypt a mnemonic for storage.
 */
export function encryptMnemonic(mnemonic: string, password: string): Buffer {
  const key = createHash('sha256').update(password).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ENCRYPTION_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(mnemonic, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv (16) + authTag (16) + encrypted
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a stored mnemonic.
 */
export function decryptMnemonic(data: Buffer, password: string): string {
  const key = createHash('sha256').update(password).digest();
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const decipher = createDecipheriv(ENCRYPTION_ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(encrypted) + decipher.final('utf8');
}

/**
 * Save wallet to disk.
 */
export function saveWallet(mnemonic: string, password: string, walletPath?: string): string {
  const dir = walletPath ? join(walletPath, '..') : DEFAULT_WALLET_DIR;
  const filePath = walletPath ?? join(DEFAULT_WALLET_DIR, DEFAULT_WALLET_FILE);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const encrypted = encryptMnemonic(mnemonic, password);
  writeFileSync(filePath, encrypted);

  return filePath;
}

/**
 * Load wallet from disk.
 */
export function loadWallet(password: string, walletPath?: string): string {
  const filePath = walletPath ?? join(DEFAULT_WALLET_DIR, DEFAULT_WALLET_FILE);

  if (!existsSync(filePath)) {
    throw new PaymentError(
      `Wallet not found at ${filePath}. Run 'openclawrouter wallet init' to create one.`,
    );
  }

  const data = readFileSync(filePath);
  return decryptMnemonic(data, password);
}

/**
 * WalletPaymentBackend — sends requests directly to providers with x402 payment.
 *
 * Flow:
 * 1. Send request to provider
 * 2. If 402: parse requirements → sign payment → retry with X-PAYMENT header
 * 3. If 2xx: return response
 * 4. CRITICAL: never retry after payment is committed
 */
export class WalletPaymentBackend implements PaymentBackend {
  private privateKey: Uint8Array | null = null;
  private address: string = '';
  private balanceMonitor: BalanceMonitor;
  private mnemonic: string;

  constructor(mnemonic: string) {
    this.mnemonic = mnemonic;
    this.balanceMonitor = new BalanceMonitor();
  }

  /**
   * Initialize the wallet (derive keys). Must be called before sendRequest.
   */
  async initialize(): Promise<WalletInfo> {
    const { privateKey, address } = await derivePrivateKey(this.mnemonic);
    this.privateKey = privateKey;
    this.address = address;

    logger.info('Wallet initialized', { address });

    return {
      address,
      publicKey: '0x' + Buffer.from(privateKey).toString('hex').slice(0, 8) + '...',
      derivationPath: DERIVATION_PATH,
    };
  }

  /** Get the wallet address. */
  getAddress(): string {
    return this.address;
  }

  /** Get the balance monitor for checking funds. */
  getBalanceMonitor(): BalanceMonitor {
    return this.balanceMonitor;
  }

  async sendRequest(params: {
    provider: ProviderConfig;
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Buffer;
    stream: boolean;
  }): Promise<ProviderResponse> {
    if (!this.privateKey) {
      throw new PaymentError('Wallet not initialized. Call initialize() first.');
    }

    // First request — no payment header
    const initialResponse = await this.rawFetch(params);

    // If not 402, return as-is
    if (initialResponse.status !== 402) {
      return initialResponse;
    }

    // Handle x402 payment
    const { paymentHeader } = await handleX402Payment(
      initialResponse,
      this.address,
      async (hash: Uint8Array) => {
        // Sign with private key
        // Use @noble/secp256k1 if available, otherwise basic ECDSA
        try {
          const { sign } = await import('@noble/secp256k1' as string);
          const sig = sign(hash, this.privateKey!);
          return sig.toCompactRawBytes();
        } catch {
          // Fallback: use Node.js crypto ECDSA
          const { createSign } = await import('node:crypto');
          const signer = createSign('SHA256');
          signer.update(hash);
          const derSig = signer.sign({
            key: Buffer.from(this.privateKey!),
            format: 'der',
            type: 'pkcs8',
          });
          return new Uint8Array(derSig);
        }
      },
    );

    // Retry with payment header — this commits the payment
    // CRITICAL: Do NOT retry after this point
    const paidResponse = await this.rawFetch({
      ...params,
      headers: {
        ...params.headers,
        'X-PAYMENT': paymentHeader,
      },
    });

    return paidResponse;
  }

  /**
   * Raw fetch to a provider URL.
   */
  private async rawFetch(params: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Buffer;
    stream: boolean;
  }): Promise<ProviderResponse> {
    const response = await fetch(params.url, {
      method: params.method,
      headers: params.headers,
      body: params.method !== 'GET' ? new Uint8Array(params.body) : undefined,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (params.stream && response.body) {
      return {
        status: response.status,
        headers: responseHeaders,
        body: Buffer.alloc(0),
        stream: response.body as unknown as ReadableStream,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      status: response.status,
      headers: responseHeaders,
      body: Buffer.from(arrayBuffer),
    };
  }
}
