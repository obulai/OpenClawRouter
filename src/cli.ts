#!/usr/bin/env node
import { Command } from 'commander';
import { start } from './index.js';
import { loadRoutingConfig } from './config/loader.js';
import { ProviderRegistry } from './providers/registry.js';
import { setLogLevel } from './logger.js';

const program = new Command();

program
  .name('openclawrouter')
  .description('Multi-provider AI model router with x402 payment support')
  .version('0.1.0');

program
  .command('start')
  .description('Start the proxy server')
  .option('-p, --port <number>', 'Port to listen on', '8402')
  .option('-c, --config <path>', 'Path to config file')
  .option('-m, --mode <mode>', 'Payment mode: obul or wallet', 'obul')
  .option('--profile <profile>', 'Routing profile: auto, eco, premium, agentic', 'auto')
  .option('--debug', 'Enable debug logging')
  .action(async (options) => {
    if (options.debug) {
      setLogLevel('debug');
    }
    if (options.port) {
      process.env.OPENCLAWROUTER_PORT = options.port;
    }
    if (options.mode) {
      process.env.OPENCLAWROUTER_MODE = options.mode;
    }
    if (options.profile) {
      process.env.OPENCLAWROUTER_PROFILE = options.profile;
    }
    await start(options.config);
  });

program
  .command('models')
  .description('List available models')
  .option('-c, --config <path>', 'Path to config file')
  .action((options) => {
    const routingConfig = loadRoutingConfig(options.config);
    const registry = new ProviderRegistry(routingConfig);
    const models = registry.listModels();
    console.log('Available models:\n');
    for (const model of models) {
      const providers = registry.getProvidersForModel(model);
      console.log(`  ${model} (${providers.length} providers)`);
    }
  });

program
  .command('providers')
  .description('List providers for a model')
  .argument('<model>', 'Model name')
  .option('-c, --config <path>', 'Path to config file')
  .action((model, options) => {
    const routingConfig = loadRoutingConfig(options.config);
    const registry = new ProviderRegistry(routingConfig);
    const providers = registry.getProvidersForModel(model);

    if (providers.length === 0) {
      console.log(`No providers found for model: ${model}`);
      return;
    }

    console.log(`Providers for ${model}:\n`);
    for (const p of providers) {
      console.log(`  ${p.id} (${p.name})`);
      console.log(`    Host: ${p.scheme}://${p.host}${p.path_prefix}`);
      console.log(`    Format: ${p.api_format}`);
      console.log(`    Priority: ${p.priority}`);
      console.log(`    Dynamic pricing: ${p.dynamic_pricing}`);
      console.log('');
    }
  });

const wallet = program
  .command('wallet')
  .description('Wallet management (wallet mode only)');

wallet
  .command('init')
  .description('Generate a new wallet')
  .option('--import', 'Import an existing mnemonic instead of generating')
  .action(async (options) => {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    try {
      let mnemonic: string;

      if (options.import) {
        mnemonic = await ask('Enter your BIP-39 mnemonic: ');
        if (!mnemonic.trim()) {
          console.error('Empty mnemonic');
          process.exit(1);
        }
      } else {
        const { generateMnemonic } = await import('./payment/wallet.js');
        mnemonic = await generateMnemonic();
        console.log('\nGenerated mnemonic (SAVE THIS SECURELY):\n');
        console.log(`  ${mnemonic}\n`);
      }

      const password = await ask('Enter encryption password (or press Enter for no password): ');

      const { saveWallet, derivePrivateKey } = await import('./payment/wallet.js');
      const path = saveWallet(mnemonic.trim(), password);
      const { address } = await derivePrivateKey(mnemonic.trim());

      console.log(`\nWallet saved to: ${path}`);
      console.log(`Address: ${address}`);
      console.log('\nFund this address with USDC on Base to start using wallet mode.');
    } finally {
      rl.close();
    }
  });

wallet
  .command('address')
  .description('Show wallet address')
  .action(async () => {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    try {
      const password = await ask('Enter wallet password: ');
      const { loadWallet, derivePrivateKey } = await import('./payment/wallet.js');
      const mnemonic = loadWallet(password);
      const { address } = await derivePrivateKey(mnemonic);
      console.log(`Address: ${address}`);
    } finally {
      rl.close();
    }
  });

wallet
  .command('balance')
  .description('Check USDC balance')
  .option('--network <network>', 'Network to check', 'base')
  .action(async (options) => {
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    try {
      const password = await ask('Enter wallet password: ');
      const { loadWallet, derivePrivateKey } = await import('./payment/wallet.js');
      const { checkBalance } = await import('./payment/balance.js');

      const mnemonic = loadWallet(password);
      const { address } = await derivePrivateKey(mnemonic);
      const info = await checkBalance(address, options.network);

      console.log(`\nWallet: ${info.address}`);
      console.log(`Network: ${info.network}`);
      console.log(`USDC Balance: ${info.balanceUSDC.toFixed(6)} USDC`);
    } finally {
      rl.close();
    }
  });

program
  .command('doctor')
  .description('Check system health and configuration')
  .option('-c, --config <path>', 'Path to config file')
  .action(async (options) => {
    console.log('OpenClawRouter Doctor\n');
    console.log('Checking configuration...\n');

    // Check config
    try {
      const routingConfig = loadRoutingConfig(options.config);
      const registry = new ProviderRegistry(routingConfig);
      const models = registry.listModels();
      console.log(`  [OK] Routing config loaded (${models.length} models)`);
    } catch (err) {
      console.log(`  [FAIL] Routing config: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Check Obul API key
    if (process.env.OBUL_API_KEY) {
      console.log('  [OK] OBUL_API_KEY is set');
    } else {
      console.log('  [WARN] OBUL_API_KEY not set (required for obul mode)');
    }

    // Check wallet
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const walletPath = join(homedir(), '.openclawrouter', 'wallet.key');
    if (existsSync(walletPath)) {
      console.log(`  [OK] Wallet found at ${walletPath}`);
    } else {
      console.log('  [INFO] No wallet found (run "openclawrouter wallet init" for wallet mode)');
    }

    // Check Node.js version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1));
    if (major >= 18) {
      console.log(`  [OK] Node.js ${nodeVersion}`);
    } else {
      console.log(`  [WARN] Node.js ${nodeVersion} (recommend >= 18)`);
    }

    // Check optional crypto deps
    for (const dep of ['@scure/bip39', '@scure/bip32', '@noble/hashes']) {
      try {
        await import(dep);
        console.log(`  [OK] ${dep} available`);
      } catch {
        console.log(`  [INFO] ${dep} not installed (needed for wallet mode)`);
      }
    }

    console.log('\nDone.');
  });

program.parse();
