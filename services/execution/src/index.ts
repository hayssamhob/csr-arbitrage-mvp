import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import cors from 'cors';
import express, { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { loadConfig, validateLiveMode } from './config';
import { Database } from './database';
import { ExecutionEngine } from './executionEngine';

// ============================================================================
// Execution Service
// Supports OFF/PAPER/LIVE modes with strict safety controls
// NO WITHDRAWALS, NO BRIDGING, NO FUND TRANSFERS
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  
  const entry = {
    level,
    service: 'execution',
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

  const config = loadConfig();

  // Validate live mode requirements
  const liveValidation = validateLiveMode(config);
  if (!liveValidation.valid) {
    log('error', 'live_mode_validation_failed', { errors: liveValidation.errors });
    if (config.EXECUTION_MODE === 'live') {
      process.exit(1);
    }
  }

  // Log startup mode with clear warnings
  log('info', 'config_loaded', {
    execution_mode: config.EXECUTION_MODE,
    kill_switch: config.KILL_SWITCH,
    max_order_usdt: config.MAX_ORDER_USDT,
    max_daily_volume_usdt: config.MAX_DAILY_VOLUME_USDT,
    min_edge_bps: config.MIN_EDGE_BPS,
  });

  if (config.EXECUTION_MODE === 'live' && !config.KILL_SWITCH) {
    log('warn', '⚠️ LIVE MODE ENABLED ⚠️', {
      message: 'Real orders will be placed on LBank',
      max_order: config.MAX_ORDER_USDT,
    });
  }

  // Initialize database
  const db = new Database(config.DB_PATH);
  
  // Initialize execution engine
  const engine = new ExecutionEngine(config, db, log);

  // Create HTTP server
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health endpoint
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'execution',
      mode: config.EXECUTION_MODE,
      kill_switch: config.KILL_SWITCH,
      ts: new Date().toISOString(),
    });
  });

  // Get current execution status
  app.get('/status', (_req: Request, res: Response) => {
    res.json(engine.getStatus());
  });

  // Get execution history
  app.get('/history', (req: Request, res: Response) => {
    const limit = parseInt(req.query.limit as string) || 50;
    const symbol = req.query.symbol as string;
    res.json(db.getHistory(limit, symbol));
  });

  // Get daily stats
  app.get('/stats', (_req: Request, res: Response) => {
    res.json(engine.getDailyStats());
  });

  // Manual execution trigger (for testing paper mode)
  app.post('/execute', async (req: Request, res: Response) => {
    const { symbol, direction, size_usdt, edge_bps } = req.body;

    if (config.KILL_SWITCH) {
      res.status(403).json({ error: 'Kill switch is active' });
      return;
    }

    if (config.EXECUTION_MODE === 'off') {
      res.status(403).json({ error: 'Execution mode is off' });
      return;
    }

    try {
      const result = await engine.execute({
        symbol,
        direction,
        size_usdt,
        edge_bps,
        idempotency_key: uuidv4(),
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // Start polling strategy engine for decisions
  if (config.EXECUTION_MODE !== 'off' && !config.KILL_SWITCH) {
    setInterval(async () => {
      try {
        const resp = await axios.get(`${config.STRATEGY_ENGINE_URL}/decision`);
        const decisions = resp.data;

        for (const symbol of ['csr_usdt', 'csr25_usdt']) {
          const decision = decisions[symbol];
          if (decision?.would_trade) {
            await engine.evaluateAndExecute(decision);
          }
        }
      } catch (err) {
        log('error', 'strategy_poll_error', { error: String(err) });
      }
    }, 5000);
  }

  app.listen(config.HTTP_PORT, () => {
    log('info', 'server_started', { 
      port: config.HTTP_PORT, 
      mode: config.EXECUTION_MODE,
      kill_switch: config.KILL_SWITCH,
    });
  });

  process.on('SIGTERM', () => {
    log('info', 'sigterm_received');
    db.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('info', 'sigint_received');
    db.close();
    process.exit(0);
  });
}

main().catch((err) => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});
