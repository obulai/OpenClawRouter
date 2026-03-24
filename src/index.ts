import { loadRoutingConfig } from './config/loader.js';
import { ProviderRegistry } from './providers/registry.js';
import { RequirementsCache } from './cache/requirements.js';
import { createPaymentBackend } from './payment/interface.js';
import { SpendController } from './payment/spend-control.js';
import { WalletPaymentBackend } from './payment/wallet.js';
import { startProxyServer } from './proxy.js';
import type { OpenClawRouterConfig, PaymentMode, RoutingProfile } from './types.js';
import { logger } from './logger.js';

/**
 * Load top-level config from environment variables with sensible defaults.
 * A config file path can override the routing config location.
 */
function loadConfig(configPath?: string): OpenClawRouterConfig {
  return {
    mode: (process.env.OPENCLAWROUTER_MODE as PaymentMode) ?? 'obul',
    port: parseInt(process.env.OPENCLAWROUTER_PORT ?? '8402', 10),
    obul_api_key: process.env.OBUL_API_KEY,
    obul_base_url: process.env.OBUL_BASE_URL ?? 'https://obul.polymerdao.xyz',
    wallet_path: process.env.OPENCLAWROUTER_WALLET_PATH,
    routing_profile: (process.env.OPENCLAWROUTER_PROFILE as RoutingProfile) ?? 'auto',
    routing_config_path: configPath,
    max_per_request: process.env.OPENCLAWROUTER_MAX_PER_REQUEST
      ? parseInt(process.env.OPENCLAWROUTER_MAX_PER_REQUEST, 10)
      : undefined,
    max_hourly: process.env.OPENCLAWROUTER_MAX_HOURLY
      ? parseInt(process.env.OPENCLAWROUTER_MAX_HOURLY, 10)
      : undefined,
    max_daily: process.env.OPENCLAWROUTER_MAX_DAILY
      ? parseInt(process.env.OPENCLAWROUTER_MAX_DAILY, 10)
      : undefined,
  };
}

export async function start(configPath?: string): Promise<void> {
  const config = loadConfig(configPath);
  const routingConfig = loadRoutingConfig(config.routing_config_path);
  const registry = new ProviderRegistry(routingConfig);
  const cache = new RequirementsCache();

  // Create payment backend
  let walletMnemonic: string | undefined;
  if (config.mode === 'wallet') {
    // Load wallet mnemonic from env or wallet file
    walletMnemonic = process.env.OPENCLAWROUTER_WALLET_MNEMONIC;
    if (!walletMnemonic) {
      try {
        const { loadWallet } = await import('./payment/wallet.js');
        const password = process.env.OPENCLAWROUTER_WALLET_PASSWORD ?? '';
        walletMnemonic = loadWallet(password, config.wallet_path);
      } catch (err) {
        logger.error('Failed to load wallet', {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }
  }

  const backend = createPaymentBackend({
    mode: config.mode,
    obulApiKey: config.obul_api_key,
    obulBaseUrl: config.obul_base_url,
    walletMnemonic,
  });

  // Initialize wallet if in wallet mode
  if (backend instanceof WalletPaymentBackend) {
    const info = await backend.initialize();
    logger.info('Wallet mode active', { address: info.address });
  }

  // Set up spend controls
  const spendController = new SpendController({
    maxPerRequest: config.max_per_request,
    maxHourly: config.max_hourly,
    maxDaily: config.max_daily,
  });

  logger.info('Starting OpenClawRouter', {
    mode: config.mode,
    port: config.port,
    profile: config.routing_profile,
    models: registry.listModels().length,
  });

  await startProxyServer({
    port: config.port,
    paymentBackend: backend,
    registry,
    requirementsCache: cache,
    mode: config.mode,
    routingProfile: config.routing_profile,
    spendController,
  });
}
