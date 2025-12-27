import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import { getQuoteSizes, loadConfig } from './config';
import { QuoteService } from './quoteService';
import { QuoteRequestSchema } from './schemas';

// ============================================================================
// Uniswap Quote Service
// READ-ONLY: Returns effective execution prices for given sizes
// Per architecture.md: Uniswap Quote Service component
// NO EXECUTION. NO SIGNING.
// ============================================================================

// Structured logger
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  
  const entry = {
    level,
    service: 'uniswap-quote',
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  const output = JSON.stringify(entry);
  
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

async function main(): Promise<void> {
  log('info', 'starting', { version: '1.0.0' });

  // Load and validate config
  const config = loadConfig();
  const quoteSizes = getQuoteSizes(config);
  
  log('info', 'config_loaded', {
    chainId: config.CHAIN_ID,
    httpPort: config.HTTP_PORT,
    quoteSizes,
    cacheTtl: config.QUOTE_CACHE_TTL_SECONDS,
  });

  // Initialize quote service
  const quoteService = new QuoteService(config, (level, event, data) => {
    log(level as LogLevel, event, data);
  });

  // Create HTTP server
  const app = express();
  app.use(express.json());

  // Health check - basic liveness
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'uniswap-quote', ts: new Date().toISOString() });
  });

  // Ready check - detailed health
  app.get('/ready', async (_req: Request, res: Response) => {
    const rpcConnected = await quoteService.testConnection();
    const consecutiveFailures = quoteService.getConsecutiveFailures();
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!rpcConnected) {
      status = 'unhealthy';
    } else if (consecutiveFailures > 3) {
      status = 'degraded';
    }

    const health = {
      service: 'uniswap-quote',
      status,
      ts: new Date().toISOString(),
      rpc_connected: rpcConnected,
      consecutive_failures: consecutiveFailures,
      cache_size: quoteService.getCacheSize(),
      chain_id: config.CHAIN_ID,
    };

    const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
    res.status(httpStatus).json(health);
  });

  // Get quote endpoint
  app.post('/quote', async (req: Request, res: Response) => {
    const parseResult = QuoteRequestSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parseResult.error.format(),
      });
      return;
    }

    const { amount_usdt, direction } = parseResult.data;
    
    log('debug', 'quote_request', { amount_usdt, direction });
    
    const quote = await quoteService.getQuote(amount_usdt, direction);
    res.json(quote);
  });

  // Get quotes for all configured sizes
  app.get('/quotes', async (_req: Request, res: Response) => {
    const quotes = await Promise.all(
      quoteSizes.map(async (size) => {
        const quote = await quoteService.getQuote(size, 'buy');
        return quote;
      })
    );
    
    res.json({
      ts: new Date().toISOString(),
      chain_id: config.CHAIN_ID,
      sizes: quoteSizes,
      quotes,
    });
  });

  // Start server
  app.listen(config.HTTP_PORT, () => {
    log('info', 'server_started', { port: config.HTTP_PORT });
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    log('info', 'sigterm_received', { message: 'Shutting down' });
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('info', 'sigint_received', { message: 'Shutting down' });
    process.exit(0);
  });
}

main().catch((err) => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});
