import dotenv from 'dotenv';
dotenv.config();

import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { getSymbolsList, loadConfig } from './config';
import { createHealthServer } from './health';
import { LBankClient } from './lbankClient';
// Relative import to shared package (Must be supported by build context)
import { MarketTick, TOPICS } from '../../../packages/shared/src';
import { LBankDepthEvent, LBankTickerEvent } from './schemas';

// ============================================================================
// LBank Gateway Service (Redis Stream Edition)
// Connects to LBank WebSocket, normalizes data, publishes to Redis 'market.data'
// ============================================================================

// Structured logger
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;

  const entry = {
    level,
    service: 'lbank-gateway',
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  console.log(JSON.stringify(entry));
}

// Error tracking
let errorCount = 0;
const errorWindow: number[] = [];
const ERROR_WINDOW_MS = 5 * 60 * 1000;

function trackError(): void {
  const now = Date.now();
  errorWindow.push(now);
  while (errorWindow.length > 0 && errorWindow[0] < now - ERROR_WINDOW_MS) {
    errorWindow.shift();
  }
  errorCount = errorWindow.length;
}

function getErrorCount(): number {
  const now = Date.now();
  while (errorWindow.length > 0 && errorWindow[0] < now - ERROR_WINDOW_MS) {
    errorWindow.shift();
  }
  return errorWindow.length;
}

// Main entry point
async function main(): Promise<void> {
  log('info', 'starting', { version: '2.0.0-redis' });

  // Load config
  const config = loadConfig();
  const symbols = getSymbolsList(config);

  log('info', 'config_loaded', {
    wsUrl: config.LBANK_WS_URL,
    symbols,
    redisUrl: config.REDIS_URL,
  });

  // Connect to Redis
  const redis = new Redis(config.REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });

  redis.on('connect', () => log('info', 'redis_connected'));
  redis.on('error', (err) => log('error', 'redis_error', { error: err.message }));

  // Helper to publish to Redis Stream
  async function publishTick(tick: MarketTick): Promise<void> {
    try {
      // XADD key * field value
      await redis.xadd(TOPICS.MARKET_DATA, '*', 'data', JSON.stringify(tick));
      // Optional: Publish to Pub/Sub for real-time UI (lighter weight)
      await redis.publish(TOPICS.MARKET_DATA, JSON.stringify(tick));
    } catch (err: any) {
      log('error', 'publish_failed', { error: err.message });
    }
  }

  // LBank Client
  const lbankClient = new LBankClient({
    wsUrl: config.LBANK_WS_URL,
    symbols,
    onLog: (level, event, data) => log(level as LogLevel, event, data),
  });

  // Handle Ticker
  lbankClient.on('ticker', (event: LBankTickerEvent) => {
    const tick: MarketTick = {
      type: 'market.tick',
      eventId: uuidv4(),
      symbol: event.symbol.toUpperCase().replace('_', '/'), // csr_usdt -> CSR/USDT
      venue: 'lbank',
      ts: Date.now(),
      bid: event.bid,
      ask: event.ask,
      last: event.last,
      sourceTs: event.source_ts ? new Date(event.source_ts).getTime() : undefined,
    };
    publishTick(tick);
  });

  // Handle Depth (Update bid/ask more accurately if needed)
  lbankClient.on('depth', (depth: LBankDepthEvent) => {
    if (depth.bids.length > 0 && depth.asks.length > 0) {
      const bestBid = depth.bids[0][0];
      const bestAsk = depth.asks[0][0];

      const tick: MarketTick = {
        type: 'market.tick',
        eventId: uuidv4(),
        symbol: depth.symbol.toUpperCase().replace('_', '/'),
        venue: 'lbank',
        ts: Date.now(),
        bid: bestBid,
        ask: bestAsk,
        last: (bestBid + bestAsk) / 2,
        sourceTs: depth.source_ts ? new Date(depth.source_ts).getTime() : undefined,
      };
      publishTick(tick);
    }
  });

  lbankClient.on('error', trackError);
  lbankClient.connect();

  // Supabase Client
  const SUPABASE_URL = config.SUPABASE_URL;
  const SUPABASE_KEY = config.SUPABASE_SERVICE_ROLE_KEY;
  const CEX_SECRETS_KEY = config.CEX_SECRETS_KEY;

  let supabase: any = null;
  if (SUPABASE_URL && SUPABASE_KEY) {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    log('info', 'supabase_connected', { url: SUPABASE_URL });
  } else {
    log('warn', 'supabase_missing', { reason: "SUPABASE_URL or KEY not set" });
  }

  // Execution Handler
  const { ExecutionHandler } = require('./execution');
  const executionHandler = new ExecutionHandler(
    supabase,
    CEX_SECRETS_KEY,
    (level: any, event: any, data: any) => log(level, event, data)
  );

  // Redis Consumer Group for Excution
  const EXECUTION_STREAM = 'execution.requests';
  const GROUP_NAME = 'lbank-executor-group';
  const CONSUMER_NAME = `lbank-executor-${uuidv4().substring(0, 8)}`;

  try {
    await redis.xgroup('CREATE', EXECUTION_STREAM, GROUP_NAME, '$', 'MKSTREAM');
    log('info', 'consumer_group_created', { group: GROUP_NAME });
  } catch (err: any) {
    if (!err.message.includes('BUSYGROUP')) {
      log('warn', 'consumer_group_init_error', { error: err.message });
    }
  }

  // Execution Loop
  async function consumeExecutionStream() {
    while (true) {
      try {
        // Use call() to avoid TypeScript strict checks on xreadgroup overloads
        const results: any = await (redis as any).call(
          'XREADGROUP',
          'GROUP', GROUP_NAME,
          CONSUMER_NAME,
          'BLOCK', '5000',
          'COUNT', '1',
          'STREAMS', EXECUTION_STREAM, '>'
        );

        if (results && Array.isArray(results)) {
          for (const streamEntry of results) {
            const [streamName, messages] = streamEntry;
            for (const msgEntry of messages) {
              const [id, fields] = msgEntry;
              // Parse message fields (array of strings)
              const data: Record<string, string> = {};
              for (let i = 0; i < fields.length; i += 2) {
                data[fields[i]] = fields[i + 1];
              }

              if (data.type === 'execution.request' && (data.venue === 'lbank' || !data.venue)) {
                try {
                  const payload = {
                    type: data.type,
                    eventId: data.eventId,
                    runId: data.runId,
                    userId: data.userId,
                    symbol: data.symbol,
                    direction: data.direction,
                    sizeUsdt: parseFloat(data.sizeUsdt),
                    minProfitBps: parseFloat(data.minProfitBps)
                  };

                  if (payload.symbol.toLowerCase().includes('csr')) {
                    await executionHandler.execute(payload);
                  }
                } catch (execErr: any) {
                  log('error', 'execution_processing_failed', { error: execErr.message });
                }
              }

              // Acknowledge message
              await redis.xack(EXECUTION_STREAM, GROUP_NAME, id);
            }
          }
        }
      } catch (err: any) {
        log('error', 'execution_consumer_error', { error: err.message });
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }

  // Start Consumer (fire and forget)
  consumeExecutionStream();

  // Health Server (Keep mostly same for compatibility)
  const healthApp = createHealthServer(lbankClient, config, symbols, getErrorCount);
  healthApp.listen(config.HTTP_PORT, () => {
    log('info', 'health_server_started', { port: config.HTTP_PORT });
  });

  // Graceful shutdown
  const shutdown = async () => {
    log('info', 'shutting_down');
    lbankClient.disconnect();
    await redis.quit();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});

