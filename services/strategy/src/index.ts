import dotenv from 'dotenv';
dotenv.config();

import http from "http";
import Redis from "ioredis";
import { v4 as uuidv4 } from 'uuid';
import { loadConfig } from './config';
// Shared imports
import {
  BusMessageSchema,
  MarketTick,
  TOPICS,
} from "../../../packages/shared/src";

// ============================================================================
// Strategy Engine
// Consumes 'market.data' from Redis
// Publishes 'strategy.signal' to Redis
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  console.log(JSON.stringify({ level, service: 'strategy', event, ts: new Date().toISOString(), ...data }));
}

// Local State
interface MarketState {
  bid?: number;
  ask?: number;
  last?: number;
  ts: number;
  venue: string;
}

// Map: Symbol -> Venue -> State
// e.g. "CSR/USDT" -> { "lbank": {...}, "uniswap_v4": {...} }
const orderBook: Record<string, Record<string, MarketState>> = {};

async function main() {
  log("info", "starting", { version: "2.0.0-redis" });
  const config = loadConfig();

  // Redis Clients
  // 1. Consumer (needs blocking connection usually, but we'll use Stream listeners via XREAD)
  const redisSub = new Redis(config.REDIS_URL);
  // 2. Publisher
  const redisPub = new Redis(config.REDIS_URL);

  // Group Consumer setup (Idempotent)
  const STREAM_KEY = TOPICS.MARKET_DATA;
  const GROUP_NAME = "strategy_group";
  const CONSUMER_NAME = `strategy_${uuidv4()}`;

  try {
    await redisSub.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "$", "MKSTREAM");
    log("info", "consumer_group_created");
  } catch (err: any) {
    if (!err.message.includes("BUSYGROUP")) {
      log("error", "xgroup_create_error", { error: err.message });
    }
  }

  // Polling Function for Stream
  async function consumeStream() {
    while (true) {
      try {
        // Read new messages using generic call to satisfy TS and avoid signature mismatch
        // XREADGROUP GROUP group consumers [COUNT n] [BLOCK ms] STREAMS key >
        const results = (await redisSub.call(
          "XREADGROUP",
          "GROUP",
          GROUP_NAME,
          CONSUMER_NAME,
          "BLOCK",
          "2000",
          "COUNT",
          "10",
          "STREAMS",
          STREAM_KEY,
          ">"
        )) as any;

        if (results) {
          // results: [[streamName, [[id, [field, value, ...]]]]]
          for (const [stream, messages] of results) {
            for (const [id, fields] of messages) {
              // fields is array of strings [key, val, key, val]
              // we want value of 'data'
              let dataStr: string | null = null;
              for (let i = 0; i < fields.length; i += 2) {
                if (fields[i] === "data") {
                  dataStr = fields[i + 1];
                  break;
                }
              }

              if (!dataStr) {
                await redisSub.xack(STREAM_KEY, GROUP_NAME, id);
                continue;
              }

              try {
                const raw = JSON.parse(dataStr);
                const event = BusMessageSchema.parse(raw); // Runtime validate

                if (event.type === "market.tick") {
                  onMarketTick(event);
                }

                // Ack message
                await redisSub.xack(STREAM_KEY, GROUP_NAME, id);
              } catch (parseErr) {
                log("warn", "message_parse_failed", {
                  id,
                  error: String(parseErr),
                });
                // Ack anyway to not get stuck? Or move to DLQ?
                // For MVP ack to move on
                await redisSub.xack(STREAM_KEY, GROUP_NAME, id);
              }
            }
          }
        }
      } catch (err: any) {
        log("error", "consume_error", { error: err.message });
        await new Promise((r) => setTimeout(r, 1000)); // Backoff
      }
    }
  }

  function onMarketTick(tick: MarketTick) {
    if (!orderBook[tick.symbol]) {
      orderBook[tick.symbol] = {};
    }

    orderBook[tick.symbol][tick.venue] = {
      bid: tick.bid,
      ask: tick.ask,
      last: tick.last,
      ts: tick.ts,
      venue: tick.venue,
    };

    // log('debug', 'market_updated', { symbol: tick.symbol, venue: tick.venue, price: tick.last });

    evaluateArbitrage(tick.symbol);
  }

  function evaluateArbitrage(symbol: string) {
    const venues = orderBook[symbol];
    if (!venues) return;

    // Check LBank vs Uniswap V4
    // We need Bid on A, Ask on B
    const cex = venues["lbank"] || venues["latoken"]; // Prefer LBank, fallback Latoken? Or treat separately
    const dex = venues["uniswap_v4"];

    if (!cex || !dex) return;

    // Logic: Buy Low, Sell High

    // 1. Buy on CEX, Sell on DEX
    // Need CEX Ask < DEX Bid (using price/last as proxy if bid/ask missing for MVP)
    const cexAsk = cex.ask || cex.last;
    const dexBid = dex.bid || dex.last; // Use last as fallback for price

    if (cexAsk && dexBid && dexBid > cexAsk) {
      const spread = (dexBid - cexAsk) / cexAsk;
      const bps = spread * 10000;

      if (bps > config.MIN_EDGE_BPS) {
        const runId = uuidv4();
        log("info", "opportunity_found", {
          runId,
          direction: "CEX->DEX",
          symbol,
          cex: cex.venue,
          buyAt: cexAsk,
          sellAt: dexBid,
          bps: Math.round(bps),
        });

        // Publish Execution Request (Simulating Strategy -> Execution direct link)
        const request = {
          type: "execution.request",
          eventId: uuidv4(),
          runId,
          symbol,
          direction: "buy_cex_sell_dex", // Simplified direction
          sizeUsdt: config.QUOTE_SIZE_USDT,
          minProfitBps: config.MIN_EDGE_BPS,
          ts: Date.now(),
        };

        // Publish to execution stream
        redisPub.xadd(
          TOPICS.EXECUTION_REQUESTS,
          "*",
          "data",
          JSON.stringify(request)
        );
        redisPub.publish(TOPICS.EXECUTION_REQUESTS, JSON.stringify(request));
      }
    }

    // 2. Buy on DEX, Sell on CEX
    // Need DEX Ask < CEX Bid
    const dexAsk = dex.ask || dex.last;
    const cexBid = cex.bid || cex.last;

    if (dexAsk && cexBid && cexBid > dexAsk) {
      const spread = (cexBid - dexAsk) / dexAsk;
      const bps = spread * 10000;

      if (bps > config.MIN_EDGE_BPS) {
        const runId = uuidv4();
        log("info", "opportunity_found", {
          runId,
          direction: "DEX->CEX",
          symbol,
          cex: cex.venue,
          buyAt: dexAsk,
          sellAt: cexBid,
          bps: Math.round(bps),
        });

        const request = {
          type: "execution.request",
          eventId: uuidv4(),
          runId,
          symbol,
          direction: "buy_dex_sell_cex",
          sizeUsdt: config.QUOTE_SIZE_USDT,
          minProfitBps: config.MIN_EDGE_BPS,
          ts: Date.now(),
        };

        redisPub.xadd(
          TOPICS.EXECUTION_REQUESTS,
          "*",
          "data",
          JSON.stringify(request)
        );
        redisPub.publish(TOPICS.EXECUTION_REQUESTS, JSON.stringify(request));
      }
    }
  }

  // Start consuming
  consumeStream();

  // Keep alive
  log("info", "strategy_engine_started");

  // Build market state for API responses
  function getMarketState() {
    const now = new Date().toISOString();

    // CSR/USDT - LATOKEN is CEX, Uniswap is DEX
    const csrLatoken =
      orderBook["csr/usdt"]?.["latoken"] || orderBook["CSR/USDT"]?.["latoken"];
    const csrUniswap =
      orderBook["csr_usdt"]?.["uniswap_v4"] ||
      orderBook["csr/usdt"]?.["uniswap_v4"];

    // CSR25/USDT - LBank is CEX, Uniswap is DEX
    const csr25Lbank =
      orderBook["csr25_usdt"]?.["lbank"] || orderBook["csr25/usdt"]?.["lbank"];
    const csr25Uniswap =
      orderBook["csr25_usdt"]?.["uniswap_v4"] ||
      orderBook["csr25/usdt"]?.["uniswap_v4"];

    return {
      ts: now,
      csr_usdt: {
        latoken_ticker: csrLatoken
          ? {
              type: "latoken.ticker",
              symbol: "csr/usdt",
              ts: new Date(csrLatoken.ts).toISOString(),
              bid: csrLatoken.bid || csrLatoken.last,
              ask: csrLatoken.ask || csrLatoken.last,
              last: csrLatoken.last,
              volume_24h: 0,
            }
          : null,
        lbank_ticker: null, // CSR not on LBank
        uniswap_quote: csrUniswap
          ? {
              type: "uniswap.quote",
              pair: "csr_usdt",
              chain_id: 1,
              ts: new Date(csrUniswap.ts).toISOString(),
              effective_price_usdt: csrUniswap.last || csrUniswap.bid,
              is_stale: Date.now() - csrUniswap.ts > 60000,
            }
          : null,
        decision: null,
      },
      csr25_usdt: {
        lbank_ticker: csr25Lbank
          ? {
              type: "lbank.ticker",
              symbol: "csr25_usdt",
              ts: new Date(csr25Lbank.ts).toISOString(),
              bid: csr25Lbank.bid || csr25Lbank.last,
              ask: csr25Lbank.ask || csr25Lbank.last,
              last: csr25Lbank.last,
              volume_24h: 0,
            }
          : null,
        latoken_ticker: null, // CSR25 not on LATOKEN
        uniswap_quote: csr25Uniswap
          ? {
              type: "uniswap.quote",
              pair: "csr25_usdt",
              chain_id: 1,
              ts: new Date(csr25Uniswap.ts).toISOString(),
              effective_price_usdt: csr25Uniswap.last || csr25Uniswap.bid,
              is_stale: Date.now() - csr25Uniswap.ts > 60000,
            }
          : null,
        decision: null,
      },
      is_stale: false,
    };
  }

  // Health Check Server with /state and /decision endpoints
  const HTTP_PORT = process.env.HTTP_PORT || 3005;
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: "healthy",
          service: "strategy",
          version: "3.0.0-redis",
          ts: new Date().toISOString(),
        })
      );
    } else if (req.url === "/state") {
      res.writeHead(200);
      res.end(JSON.stringify(getMarketState()));
    } else if (req.url === "/decision") {
      // Return current arbitrage opportunities
      const state = getMarketState();
      res.writeHead(200);
      res.end(
        JSON.stringify({
          ts: new Date().toISOString(),
          csr_usdt: {
            would_trade: false,
            reason:
              state.csr_usdt.latoken_ticker && state.csr_usdt.uniswap_quote
                ? "spread_too_small"
                : "missing_data",
          },
          csr25_usdt: {
            would_trade: false,
            reason:
              state.csr25_usdt.lbank_ticker && state.csr25_usdt.uniswap_quote
                ? "spread_too_small"
                : "missing_data",
          },
        })
      );
    } else if (req.url === "/orderbook") {
      // Debug endpoint to see raw orderbook state
      res.writeHead(200);
      res.end(JSON.stringify(orderBook));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
    }
  });

  server.listen(HTTP_PORT, () => {
    log("info", "http_server_started", { port: HTTP_PORT });
  });

  // Graceful shutdown
  const shutdown = async () => {
    log("info", "shutting_down");
    server.close();
    await redisSub.quit();
    await redisPub.quit();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});
