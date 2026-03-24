# OpenClawRouter

OpenClaw plugin that routes AI model requests to the cheapest x402 provider with automatic failover and smart model selection.

## Install

```bash
openclaw plugins add --source git --url https://github.com/obulai/OpenClawRouter
```

Or manually:

```bash
git clone https://github.com/obulai/OpenClawRouter ~/.openclaw/extensions/openclawrouter
cd ~/.openclaw/extensions/openclawrouter && npm install && npm run build
```

## Configure

Add to `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "entries": {
      "openclawrouter": {
        "enabled": true,
        "config": {
          "mode": "obul",
          "routingProfile": "auto",
          "obulApiKey": "your-key-here"
        }
      }
    }
  }
}
```

Or just set the env var:

```bash
export OBUL_API_KEY=your-key-here
```

## What It Does

Once installed, the plugin:

1. **Registers `/v1/chat/completions`** on the gateway — an OpenAI-compatible endpoint that routes through 6 x402 providers
2. **Hooks into `before_model_resolve`** — when an agent requests `model: "auto"`, the 14-dimension classifier picks the optimal model tier
3. **Registers slash commands** — `/providers` and `/routing` for visibility

### How Routing Works

```
Agent sends LLM request
  │
  ▼
Smart Routing (14-dimension classifier)
  ├─ Explicit model → use it
  └─ "auto" → classify → pick tier → pick model
  │
  ▼
Provider Selection
  ├─ Find all providers for model
  ├─ Probe x402 pricing (parallel, 2s timeout)
  ├─ Sort cheapest-first
  └─ Spend control check
  │
  ▼
Failover Loop (up to 4 attempts)
  ├─ Translate request to provider format
  ├─ Send via payment backend (Obul proxy or direct x402)
  ├─ Translate response back to OpenAI format
  └─ On 5xx/429/timeout → next provider
  │
  ▼
Response + headers (x-provider, x-mode, x-failover-count, x-routing-tier)
```

## Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | `"obul"` \| `"wallet"` | `"obul"` | Payment mode |
| `routingProfile` | `"auto"` \| `"eco"` \| `"premium"` \| `"agentic"` | `"auto"` | Smart routing profile |
| `obulApiKey` | string | — | Obul API key (or `OBUL_API_KEY` env) |
| `obulBaseUrl` | string | `https://obul.polymerdao.xyz` | Obul proxy URL |
| `walletMnemonic` | string | — | BIP-39 mnemonic for wallet mode |
| `maxPerRequest` | integer | — | Max spend per request (USD cents) |
| `maxHourly` | integer | — | Max hourly spend (USD cents) |
| `maxDaily` | integer | — | Max daily spend (USD cents) |

## Payment Modes

**Obul mode** (recommended): Routes through Obul's proxy. Obul handles x402 payment. You just need an API key.

**Wallet mode**: Routes directly to providers. A local BIP-39 wallet signs x402 payments with USDC on Base.

## Routing Profiles

| Profile | Simple | Medium | Complex | Reasoning |
|---------|--------|--------|---------|-----------|
| **auto** | gemini-3.1-flash-lite | claude-sonnet-4-6 | claude-opus-4-6 | claude-opus-4-6 |
| **eco** | gemini-3.1-flash-lite | deepseek-v3.2 | claude-sonnet-4-6 | claude-sonnet-4-6 |
| **premium** | claude-sonnet-4-6 | claude-opus-4-6 | gpt-5 | claude-opus-4-6 |
| **agentic** | claude-sonnet-4-6 | claude-sonnet-4-6 | claude-opus-4-6 | claude-opus-4-6 |

## Providers

| Provider | Host | Format | Dynamic Pricing |
|----------|------|--------|-----------------|
| x402engine | x402engine.app | x402engine | No |
| BlockRun | blockrun.ai | blockrun | Yes |
| Daydreams | ai.xgate.run | openai | Yes |
| AskClaude | askclaude.shop | askclaude | No |
| Spraay | gateway.spraay.app | spraay | No |
| MiniMaxxing | minimaxxing.x402endpoints.com | openai | No |

## Slash Commands

- `/providers [model]` — list providers (or all models if no argument)
- `/routing` — show current mode, profile, and cache stats

## Standalone Mode

For non-OpenClaw usage, a standalone proxy is available:

```bash
OBUL_API_KEY=your-key npx openclawrouter start
curl http://localhost:8402/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-6", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Development

```bash
npm install
npm test        # 263 tests
npm run lint    # type check
npm run build
```

## License

MIT
