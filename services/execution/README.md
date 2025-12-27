# Execution Service

Handles trade execution for CSR arbitrage with strict safety controls.

## Features

- **Three execution modes**:
  - `off`: Monitoring only, no orders placed
  - `paper`: Simulate fills, store to local SQLite DB
  - `live`: Place REAL orders on LBank (requires API keys)

- **Safety controls**:
  - Kill switch to disable ALL execution
  - Order size limits
  - Daily volume limits
  - Minimum edge thresholds
  - Maximum concurrent orders
  - Idempotency protection

- **Persistence**:
  - SQLite database stores all decisions and trades
  - Full audit trail
  - Paper trade P&L tracking

## Configuration

See `.env` for all configuration options.

### Critical Settings

```bash
# Execution mode (NEVER commit live mode with real keys)
EXECUTION_MODE=off

# Kill switch - set to true to disable ALL execution
KILL_SWITCH=true

# Risk limits
MAX_ORDER_USDT=1000
MAX_DAILY_VOLUME_USDT=10000
MIN_EDGE_BPS=50
MAX_CONCURRENT_ORDERS=1
```

### Live Mode Requirements

For live trading, you must provide:
- `LBANK_API_KEY`
- `LBANK_API_SECRET`
- `EXECUTION_MODE=live`
- `KILL_SWITCH=false`

## API Endpoints

- `GET /health` - Service health
- `GET /status` - Current execution status and limits
- `GET /history?limit=50&symbol=csr_usdt` - Trade history
- `GET /stats` - Daily statistics
- `POST /execute` - Manual execution trigger (testing only)

## Database Schema

```sql
CREATE TABLE trades (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  size_usdt REAL NOT NULL,
  edge_bps REAL NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  fill_price REAL,
  pnl_usdt REAL,
  error TEXT,
  idempotency_key TEXT UNIQUE
);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  symbol TEXT NOT NULL,
  lbank_bid REAL NOT NULL,
  lbank_ask REAL NOT NULL,
  uniswap_price REAL NOT NULL,
  raw_spread_bps REAL NOT NULL,
  edge_after_costs_bps REAL NOT NULL,
  would_trade INTEGER NOT NULL,
  direction TEXT NOT NULL,
  suggested_size_usdt REAL NOT NULL,
  executed INTEGER DEFAULT 0
);
```

## Running

```bash
npm install
npm run dev    # Development mode
npm run build  # Build for production
npm start      # Production mode
```

## Security Notes

- **NEVER commit API keys** to version control
- Always use environment variables for secrets
- Kill switch defaults to `true` (disabled)
- Live mode requires explicit configuration
- No withdrawals, bridging, or fund transfers - spot orders only
- All trades logged with full audit trail

## Integration

The execution service polls the Strategy Engine for decisions:
- Connects to `STRATEGY_ENGINE_URL` (default: http://localhost:3003)
- Fetches decisions every 5 seconds
- Executes if all safety checks pass
- Records all decisions and trades
