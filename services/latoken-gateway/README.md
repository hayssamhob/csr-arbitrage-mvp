# Latoken Gateway

Market data gateway for Latoken exchange, providing CSR/USDT pricing for arbitrage analysis.

## Features

- **REST API polling**: Fetches ticker data from Latoken every 2 seconds
- **Internal WebSocket broadcast**: Normalizes data and broadcasts to strategy engine
- **Health endpoints**: `/health`, `/ready`, `/metrics` for monitoring
- **Error handling**: Graceful degradation when API is unavailable
- **Structured logging**: JSON logs with configurable levels

## Configuration

See `.env` for all configuration options.

### Required Settings

```bash
# Latoken API credentials (DO NOT commit to version control)
LATOKEN_API_KEY=your_api_key_here
LATOKEN_API_SECRET=your_api_secret_here

# API endpoint
LATOKEN_API_URL=https://api.latoken.com

# Symbols to monitor
SYMBOLS=CSR_USDT
```

### Optional Settings

```bash
# Service ports
INTERNAL_WS_PORT=8081    # Internal WebSocket for broadcasting
HTTP_PORT=3006           # Health check endpoints

# Polling settings
POLL_INTERVAL_MS=2000    # API polling frequency
MAX_STALENESS_SECONDS=15 # Data staleness threshold

# Logging
LOG_LEVEL=info
```

## API Endpoints

- `GET /health` - Basic liveness check
- `GET /ready` - Detailed health with staleness info
- `GET /metrics` - Prometheus-style metrics

## Data Flow

1. **Polling**: Client polls Latoken REST API every `POLL_INTERVAL_MS`
2. **Normalization**: Raw API response normalized to internal schema
3. **Broadcast**: Normalized ticker sent via internal WebSocket
4. **Consumption**: Strategy engine subscribes to internal WebSocket

## Schema Compatibility

Output schema matches LBank gateway for compatibility:

```typescript
{
  type: "latoken.ticker",
  symbol: "csr_usdt",
  ts: "2025-12-27T10:30:00.000Z",
  bid: 0.001638,
  ask: 0.001640,
  last: 0.001639,
  volume_24h: 1000000,
  source_ts: "2025-12-27T10:30:00.000Z"
}
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
- Use environment variables for all secrets
- API keys should have read-only permissions for market data
- No trading or withdrawal permissions required

## Integration

The gateway broadcasts on port 8081 (default) for internal consumption:
- Strategy engine connects to `ws://localhost:8081`
- Receives `latoken.ticker` events
- Uses alongside LBank data for arbitrage analysis

## Troubleshooting

- Check `/ready` endpoint for service health
- Verify API credentials have market data permissions
- Monitor logs for API rate limiting or errors
- Ensure symbol format matches Latoken expectations
