---

# agents.md

```md
# Agents & Responsibilities (Lean MVP)

This file defines “who does what” (human + AI) and the boundaries.

## Human Owner (You)
- Defines trading intent: monitoring vs execution, thresholds, risk appetite.
- Supplies:
  - token addresses & chain IDs
  - Uniswap pool fee tiers if needed
  - LBank symbols and desired markets (CSR/USDT, CSR25/USDT)
- Runs the code and reviews diffs before deploying.

## AI / Windsurf Agent
Primary job: build small, correct increments that pass local runs.

### Allowed
- Generate TypeScript services, schemas, validators, reconnect logic.
- Add health endpoints.
- Add structured logging.
- Add simple tests (smoke tests / type checks).

### Not Allowed
- Implement withdrawals, bridging, or any “move funds” automation.
- Store secrets in code, commit `.env`, or print secrets in logs.
- Make assumptions about token addresses or chain configuration.

## “Virtual Agents” inside the repo
We treat each service as an “agent” with a clear contract.

### 1) MarketDataAgent (LBank Gateway)
Responsibilities:
- Connect to LBank WS
- Subscribe to configured symbols
- Normalize events
- Broadcast to internal WS
- Track staleness & reconnections

Inputs:
- `LBANK_WS_URL`
- `SYMBOLS=csr_usdt,csr25_usdt`

Outputs:
- Internal WS events: `lbank.ticker`, optionally `lbank.depth`

### 2) DexQuoteAgent (Uniswap Quote)
Responsibilities:
- Return effective quote price for a given size
- Cache results (short TTL)
- Validate configuration (token addresses, chain ID)

Inputs:
- `CHAIN_ID`
- `RPC_URL`
- token addresses + decimals
- quote sizes

Outputs:
- `uniswap.quote`

### 3) StrategyAgent (Dry Run)
Responsibilities:
- Consume LBank ticker + Uniswap quote
- Compute:
  - raw spread
  - edge after costs (fees, gas estimate, slippage buffer)
- Emit decision events:
  - `strategy.decision` (dry-run)

Hard limits:
- build the app to execute real trades
- only logs decisions
- do not use any placeholders instead of real values

### 4) DashboardAgent (later)
Responsibilities:
- Display all streams + health
- Allow toggling dry-run parameters (later)

---

## Definition of Done (per change)

- TypeScript builds cleanly
- Service starts locally
- Health endpoint returns OK
- Logs show normalized events
- No secrets leaked
