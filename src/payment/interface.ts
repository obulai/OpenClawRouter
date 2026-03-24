import type { PaymentBackend } from '../types.js';
import { ObulPaymentBackend } from './obul.js';
import { WalletPaymentBackend } from './wallet.js';

/**
 * Factory to create the appropriate payment backend based on mode.
 */
export function createPaymentBackend(config: {
  mode: 'obul' | 'wallet';
  obulApiKey?: string;
  obulBaseUrl?: string;
  walletMnemonic?: string;
}): PaymentBackend {
  switch (config.mode) {
    case 'obul': {
      if (!config.obulApiKey) {
        throw new Error('Obul API key is required for obul payment mode');
      }
      return new ObulPaymentBackend(config.obulApiKey, config.obulBaseUrl);
    }
    case 'wallet': {
      if (!config.walletMnemonic) {
        throw new Error(
          'Wallet mnemonic is required for wallet mode. Run "openclawrouter wallet init" first.',
        );
      }
      return new WalletPaymentBackend(config.walletMnemonic);
    }
    default: {
      const _exhaustive: never = config.mode;
      throw new Error(`Unknown payment mode: ${_exhaustive}`);
    }
  }
}
