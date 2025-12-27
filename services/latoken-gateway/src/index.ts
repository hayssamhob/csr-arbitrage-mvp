import dotenv from 'dotenv';
dotenv.config();

import WebSocket, { WebSocketServer } from 'ws';
import { getSymbolsList, loadConfig } from "./config";
import { createHealthServer } from './health';
import { LatokenClient } from './latokenClient';
import { LatokenTickerEvent } from './schemas';

// ============================================================================
// LATOKEN Gateway Service
// REST polling via CCXT, normalizes data, broadcasts via internal WS
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  
  const entry = {
    level,
    service: 'latoken-gateway',
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  console.log(JSON.stringify(entry));
}

async function main(): Promise<void> {
  log('info', 'starting', { version: '1.1.0' });

  const config = loadConfig();
  const symbols = getSymbolsList(config);
  
  log('info', 'config_loaded', {
    symbols,
    httpPort: config.HTTP_PORT,
    wsPort: config.INTERNAL_WS_PORT,
    pollIntervalMs: config.POLL_INTERVAL_MS,
  });

  // Create internal WebSocket server
  const wss = new WebSocketServer({ port: config.INTERNAL_WS_PORT });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    log('info', 'client_connected', { totalClients: clients.size + 1 });
    clients.add(ws);
    ws.on('close', () => {
      clients.delete(ws);
      log('info', 'client_disconnected', { totalClients: clients.size });
    });
  });

  log('info', 'internal_ws_started', { port: config.INTERNAL_WS_PORT });

  function broadcast(message: LatokenTickerEvent): void {
    const payload = JSON.stringify(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // Create LATOKEN client with CCXT
  const latokenClient = new LatokenClient({
    apiKey: config.LATOKEN_API_KEY,
    apiSecret: config.LATOKEN_API_SECRET,
    symbols,
    pollIntervalMs: config.POLL_INTERVAL_MS,
    config: {
      MOCK_MODE: config.MOCK_MODE,
      MOCK_BID: config.MOCK_BID,
      MOCK_ASK: config.MOCK_ASK,
      MOCK_LAST: config.MOCK_LAST,
    },
    onLog: (level, event, data) => log(level as LogLevel, event, data),
  });

  latokenClient.on('ticker', (ticker: LatokenTickerEvent) => {
    broadcast(ticker);
  });

  // Start client (async)
  await latokenClient.start();

  // Start health HTTP server
  const healthApp = createHealthServer(latokenClient, config, symbols);
  healthApp.listen(config.HTTP_PORT, () => {
    log('info', 'health_server_started', { port: config.HTTP_PORT });
  });

  process.on('SIGTERM', () => {
    log('info', 'sigterm_received');
    latokenClient.stop();
    wss.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('info', 'sigint_received');
    latokenClient.stop();
    wss.close();
    process.exit(0);
  });
}

main().catch((err) => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});
