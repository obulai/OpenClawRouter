#!/usr/bin/env node
/**
 * Standalone CLI — optional, for non-OpenClaw usage.
 * Primary integration is the OpenClaw plugin (extension.ts).
 */

import { Command } from 'commander';
import { startProxyServer } from './proxy.js';
import { loadRoutingConfig } from './config/loader.js';
import { ProviderRegistry } from './providers/registry.js';
import { setLogLevel } from './logger.js';
import type { PaymentMode, RoutingProfile } from './types.js';

const program = new Command();

program
  .name('openclawrouter')
  .description('Multi-provider AI model router with x402 payment support')
  .version('0.1.0');

program
  .command('start')
  .description('Start the standalone proxy server (use the OpenClaw plugin for production)')
  .option('-p, --port <number>', 'Port to listen on', '8402')
  .option('-c, --config <path>', 'Path to routing config file')
  .option('-m, --mode <mode>', 'Payment mode: obul or wallet', 'obul')
  .option('--profile <profile>', 'Routing profile: auto, eco, premium, agentic', 'auto')
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    if (options.debug) setLogLevel('debug');

    await startProxyServer({
      port: parseInt(options.port, 10),
      mode: (options.mode ?? process.env.OPENCLAWROUTER_MODE ?? 'obul') as PaymentMode,
      routingProfile: (options.profile ?? process.env.OPENCLAWROUTER_PROFILE ?? 'auto') as RoutingProfile,
      routingConfigPath: options.config,
      obulApiKey: process.env.OBUL_API_KEY,
      obulBaseUrl: process.env.OBUL_BASE_URL,
      walletMnemonic: process.env.OPENCLAWROUTER_WALLET_MNEMONIC,
    });
  });

program
  .command('models')
  .description('List available models')
  .option('-c, --config <path>', 'Path to routing config file')
  .action((options) => {
    const routingConfig = loadRoutingConfig(options.config);
    const registry = new ProviderRegistry(routingConfig);
    for (const model of registry.listModels()) {
      const providers = registry.getProvidersForModel(model);
      console.log(`  ${model} (${providers.length} providers)`);
    }
  });

program
  .command('providers <model>')
  .description('List providers for a model')
  .option('-c, --config <path>', 'Path to routing config file')
  .action((model, options) => {
    const routingConfig = loadRoutingConfig(options.config);
    const registry = new ProviderRegistry(routingConfig);
    const providers = registry.getProvidersForModel(model);
    if (providers.length === 0) {
      console.log(`No providers found for model: ${model}`);
      return;
    }
    for (const p of providers) {
      console.log(`  ${p.id} — ${p.scheme}://${p.host}${p.path_prefix} [${p.api_format}] priority=${p.priority}`);
    }
  });

program.parse();
