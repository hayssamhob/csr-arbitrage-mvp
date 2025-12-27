import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response } from 'express';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import { loadConfig } from './config';
import {
    LBankTickerEventSchema,
    StrategyDecision,
    UniswapQuoteResultSchema,
} from './schemas';
import { StrategyEngine, MarketState } from './strategyEngine';

// ============================================================================
// Strategy Engine Service
// DRY-RUN ONLY: Monitors spreads and logs decisions
// Supports multiple markets: CSR/USDT and CSR25/USDT
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  
  const entry = {
    level,
    service: 'strategy',
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  const output = JSON.stringify(entry);
  
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}

// Track decisions per market
const lastDecisions: Record<string, StrategyDecision | null> = {
  csr_usdt: null,
  csr25_usdt: null,
};
let decisionCount = 0;
let wouldTradeCount = 0;

async function main(): Promise<void> {
  log('info', 'starting', { version: '1.0.0', mode: 'DRY_RUN_ONLY' });

  const config = loadConfig();
  
  log('info', 'config_loaded', {
    symbols: config.SYMBOLS,
    minEdgeBps: config.MIN_EDGE_BPS,
    estimatedCostBps: config.ESTIMATED_COST_BPS,
    quoteSizeUsdt: config.QUOTE_SIZE_USDT,
    lbankGateway: config.LBANK_GATEWAY_WS_URL,
    uniswapQuoteUrlCSR25: config.UNISWAP_QUOTE_URL,
    uniswapQuoteUrlCSR: config.UNISWAP_QUOTE_CSR_URL,
  });

  // Initialize strategy engine
  const engine = new StrategyEngine(
    config,
    (level, event, data) => log(level as LogLevel, event, data),
    (decision) => {
      lastDecisions[decision.symbol.toLowerCase()] = decision;
      decisionCount++;
      if (decision.would_trade) {
        wouldTradeCount++;
        log('info', 'DRY_RUN_WOULD_TRADE', {
          symbol: decision.symbol,
          direction: decision.direction,
          size: decision.suggested_size_usdt,
          edge_bps: decision.edge_after_costs_bps,
          note: 'NO EXECUTION - DRY RUN ONLY',
        });
      }
    }
  );

  // Connect to LBank Gateway WebSocket
  let ws: WebSocket | null = null;
  let wsReconnectAttempts = 0;

  function connectLBankGateway(): void {
    log('info', 'connecting_to_lbank_gateway', { url: config.LBANK_GATEWAY_WS_URL });
    
    ws = new WebSocket(config.LBANK_GATEWAY_WS_URL);

    ws.on('open', () => {
      log('info', 'lbank_gateway_connected');
      wsReconnectAttempts = 0;
    });

    ws.on('message', (data: WebSocket.RawData) => {
      try {
        const parsed = JSON.parse(data.toString());
        
        const tickerResult = LBankTickerEventSchema.safeParse(parsed);
        if (tickerResult.success) {
          engine.updateLBankTicker(tickerResult.data);
        }
      } catch (err) {
        log('warn', 'ws_message_parse_error', { error: String(err) });
      }
    });

    ws.on('close', () => {
      log('warn', 'lbank_gateway_disconnected');
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      log('error', 'lbank_gateway_error', { error: err.message });
    });
  }

  function scheduleReconnect(): void {
    wsReconnectAttempts++;
    const delay = Math.min(5000 * Math.pow(1.5, wsReconnectAttempts - 1), 60000);
    log('info', 'scheduling_reconnect', { attempt: wsReconnectAttempts, delayMs: delay });
    setTimeout(connectLBankGateway, delay);
  }

  connectLBankGateway();

  // Poll Uniswap Quote Services for both markets
  async function pollUniswapQuote(url: string, symbol: string): Promise<void> {
    try {
      const response = await fetch(`${url}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount_usdt: config.QUOTE_SIZE_USDT,
          direction: 'buy',
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const quoteResult = UniswapQuoteResultSchema.safeParse(data);
      
      if (quoteResult.success) {
        engine.updateUniswapQuote(quoteResult.data, symbol);
      } else {
        log('warn', 'invalid_quote_response', { symbol, errors: quoteResult.error.format() });
      }
    } catch (err) {
      log('error', 'uniswap_quote_fetch_error', { symbol, error: String(err) });
    }
  }

  // Poll both quote services
  async function pollAllQuotes(): Promise<void> {
    await Promise.all([
      pollUniswapQuote(config.UNISWAP_QUOTE_URL, 'csr25_usdt'),
      pollUniswapQuote(config.UNISWAP_QUOTE_CSR_URL, 'csr_usdt'),
    ]);
  }

  setInterval(pollAllQuotes, config.UNISWAP_POLL_INTERVAL_MS);
  pollAllQuotes();

  // Create HTTP server
  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'strategy', 
      mode: 'DRY_RUN_ONLY',
      ts: new Date().toISOString() 
    });
  });

  app.get('/ready', (_req: Request, res: Response) => {
    const state = engine.getState();
    const wsConnected = ws?.readyState === WebSocket.OPEN;

    const csrHasData = !!state.csr_usdt.lbankTicker && !!state.csr_usdt.uniswapQuote;
    const csr25HasData = !!state.csr25_usdt.lbankTicker && !!state.csr25_usdt.uniswapQuote;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (!wsConnected || (!csrHasData && !csr25HasData)) {
      status = 'unhealthy';
    } else if (!csrHasData || !csr25HasData) {
      status = 'degraded';
    }

    const health = {
      service: 'strategy',
      mode: 'DRY_RUN_ONLY',
      status,
      ts: new Date().toISOString(),
      ws_connected: wsConnected,
      markets: {
        csr_usdt: {
          has_lbank_data: !!state.csr_usdt.lbankTicker,
          has_uniswap_data: !!state.csr_usdt.uniswapQuote,
          last_lbank_update: state.csr_usdt.lastLbankUpdate,
          last_uniswap_update: state.csr_usdt.lastUniswapUpdate,
        },
        csr25_usdt: {
          has_lbank_data: !!state.csr25_usdt.lbankTicker,
          has_uniswap_data: !!state.csr25_usdt.uniswapQuote,
          last_lbank_update: state.csr25_usdt.lastLbankUpdate,
          last_uniswap_update: state.csr25_usdt.lastUniswapUpdate,
        },
      },
      decision_count: decisionCount,
      would_trade_count: wouldTradeCount,
    };

    const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
    res.status(httpStatus).json(health);
  });

  app.get('/decision', (_req: Request, res: Response) => {
    res.json({
      csr_usdt: lastDecisions.csr_usdt,
      csr25_usdt: lastDecisions.csr25_usdt,
    });
  });

  app.get('/state', (_req: Request, res: Response) => {
    const state = engine.getState();
    res.json({
      ts: new Date().toISOString(),
      csr_usdt: {
        lbank_ticker: state.csr_usdt.lbankTicker,
        uniswap_quote: state.csr_usdt.uniswapQuote,
        decision: state.csr_usdt.decision,
      },
      csr25_usdt: {
        lbank_ticker: state.csr25_usdt.lbankTicker,
        uniswap_quote: state.csr25_usdt.uniswapQuote,
        decision: state.csr25_usdt.decision,
      },
    });
  });

  app.listen(config.HTTP_PORT, () => {
    log('info', 'server_started', { port: config.HTTP_PORT, mode: 'DRY_RUN_ONLY' });
  });

  process.on('SIGTERM', () => {
    log('info', 'sigterm_received', { message: 'Shutting down' });
    ws?.close();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    log('info', 'sigint_received', { message: 'Shutting down' });
    ws?.close();
    process.exit(0);
  });
}

main().catch((err) => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});
