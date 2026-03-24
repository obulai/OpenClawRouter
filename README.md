# OpenClawRouter

Multi-provider AI model router with x402 payment support. Routes OpenAI-compatible requests to the cheapest available x402 provider with automatic failover and smart model selection.

## Features

- **Multi-provider routing** — routes to 6 x402 providers (x402engine, BlockRun, Daydreams, AskClaude, Spraay, MiniMaxxing)
- **Cheapest-first pricing** — probes all providers for x402 pricing, sorts by cost
- **Automatic failover** — retries on 5xx/429/timeout, stops on 4xx (up to 4 attempts)
- **Smart model selection** — 14-dimension request classifier auto-picks the right model tier
- **Two payment modes**:
  - **Obul mode** — routes through Obul's proxy; Obul handles x402 payment (just need an API key)
  - **Wallet mode** — routes directly to providers; local BIP-39 wallet signs x402 payments on Base
- **Request deduplication** — SHA-256 dedup prevents duplicate charges from rapid retries
- **Response caching** — LRU cache for non-streaming responses (10min TTL)
- **Spend controls** — per-request, hourly, and daily spending limits
- **Format translation** — automatically translates between OpenAI format and 5 provider-specific formats
- **Streaming support** — SSE passthrough for streaming responses

## Quick Start

```bash
npm install
npm run build
```

### Obul Mode (recommended for getting started)

```bash
export OBUL_API_KEY=your-key-here
npx openclawrouter start
```

### Wallet Mode (direct x402 payments)

```bash
# Generate a wallet
npx openclawrouter wallet init

# Fund the wallet with USDC on Base, then:
npx openclawrouter start --mode wallet
```

### Send requests

```bash
# Explicit model selection
curl http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-6", "messages": [{"role": "user", "content": "Hello!"}]}'

# Smart routing (auto-selects model based on request complexity)
curl http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello!"}]}'
```

## CLI

```bash
openclawrouter start [options]        # Start the proxy server
  -p, --port <number>                 # Port (default: 8402)
  -m, --mode <obul|wallet>            # Payment mode (default: obul)
  --profile <auto|eco|premium|agentic> # Routing profile (default: auto)
  --debug                             # Enable debug logging

openclawrouter models                 # List available models
openclawrouter providers <model>      # List providers for a model
openclawrouter wallet init [--import] # Generate or import a wallet
openclawrouter wallet address         # Show wallet address
openclawrouter wallet balance         # Check USDC balance
openclawrouter doctor                 # Check system health
```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OBUL_API_KEY` | Obul API key (obul mode) | — |
| `OBUL_BASE_URL` | Obul proxy URL | `https://obul.polymerdao.xyz` |
| `OPENCLAWROUTER_MODE` | Payment mode | `obul` |
| `OPENCLAWROUTER_PORT` | Proxy port | `8402` |
| `OPENCLAWROUTER_PROFILE` | Routing profile | `auto` |
| `OPENCLAWROUTER_MAX_PER_REQUEST` | Max spend per request (USD cents) | — |
| `OPENCLAWROUTER_MAX_HOURLY` | Max hourly spend (USD cents) | — |
| `OPENCLAWROUTER_MAX_DAILY` | Max daily spend (USD cents) | — |

### Custom Routing Config

Place a JSON file at `~/.openclawrouter/config.json` to override default provider configuration. See `src/config/defaults.json` for the schema.

## Architecture

```
Client (curl / SDK / agent)
  │
  ▼
Local Proxy (localhost:8402, OpenAI-compatible)
  ├─ Dedup cache (SHA-256, 30s TTL)
  ├─ Response cache (LRU, 10min TTL)
  │
  ▼
Smart Routing (14-dimension classifier)
  ├─ Explicit: model specified → use it
  └─ Auto: classify request → pick tier → pick model
  │
  ▼
Provider Selection
  ├─ Find all providers offering target model
  ├─ Probe pricing (parallel, 2s timeout)
  ├─ Sort cheapest-first
  └─ Apply force-provider override (x-force-provider header)
  │
  ▼
Failover Loop (up to 4 attempts)
  │  1. Translate request to provider format
  │  2. Send via payment backend (Obul proxy or direct x402)
  │  3. Translate response back to OpenAI format
  │  4. Retry on 5xx/429/timeout → next provider
  │
  ▼
Response (OpenAI JSON or SSE stream)
  + x-provider, x-mode, x-failover-count, x-routing-tier headers
```

### Routing Profiles

| Profile | Simple | Medium | Complex | Reasoning |
|---------|--------|--------|---------|-----------|
| **auto** | gemini-3.1-flash-lite | claude-sonnet-4-6 | claude-opus-4-6 | claude-opus-4-6 |
| **eco** | gemini-3.1-flash-lite | deepseek-v3.2 | claude-sonnet-4-6 | claude-sonnet-4-6 |
| **premium** | claude-sonnet-4-6 | claude-opus-4-6 | gpt-5 | claude-opus-4-6 |
| **agentic** | claude-sonnet-4-6 | claude-sonnet-4-6 | claude-opus-4-6 | claude-opus-4-6 |

### Supported Providers

| Provider | Host | Format | Dynamic Pricing |
|----------|------|--------|-----------------|
| x402engine | x402engine.app | x402engine | No |
| BlockRun | blockrun.ai | blockrun | Yes |
| Daydreams | ai.xgate.run | openai | Yes |
| AskClaude | askclaude.shop | askclaude | No |
| Spraay | gateway.spraay.app | spraay | No |
| MiniMaxxing | minimaxxing.x402endpoints.com | openai | No |

## Development

```bash
npm install
npm test              # Run tests
npm run lint          # Type check
npm run build         # Build with tsup
```

## License

MIT
