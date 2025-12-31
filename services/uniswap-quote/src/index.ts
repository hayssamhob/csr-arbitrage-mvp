import * as dotenv from 'dotenv';
dotenv.config();

import http from "http";
import Redis from 'ioredis';
import { v4 as uuidv4 } from "uuid";
import {
  createPublicClient,
  formatUnits,
  parseAbi,
  http as viemHttp,
} from "viem";
import { mainnet } from "viem/chains";

// ============================================================================
// Uniswap V4 Gateway Service
// Fetches real prices from Uniswap V4 StateView contract
// Reference: https://docs.uniswap.org/contracts/v4/guides/state-view
// ============================================================================

// Structured logging
type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  console.log(JSON.stringify({ level, service: 'uniswap-v4-gateway', event, ts: new Date().toISOString(), ...data }));
}

// Token configurations
const TOKENS = {
  USDT: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`, decimals: 6, symbol: 'USDT' },
  WETH: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`, decimals: 18, symbol: 'WETH' },
  CSR: { address: '0x75Ecb52e403C617679FBd3e77A50f9d10A842387' as `0x${string}`, decimals: 18, symbol: 'CSR' },
  CSR25: { address: '0x502E7230E142A332DFEd1095F7174834b2548982' as `0x${string}`, decimals: 18, symbol: 'CSR25' },
};

// Uniswap V4 StateView contract on mainnet
const STATE_VIEW_ADDRESS = '0x7ffe42c4a5deea5b0fec41c94c136cf115597227' as `0x${string}`;

// StateView ABI for reading pool state
const STATE_VIEW_ABI = parseAbi([
  'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)',
  'function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity)',
]);

// Convert sqrtPriceX96 to human-readable price
function sqrtPriceX96ToPrice(sqrtPriceX96: bigint, token0Decimals: number, token1Decimals: number): number {
  const Q96 = BigInt(2) ** BigInt(96);
  const price = (Number(sqrtPriceX96) / Number(Q96)) ** 2;
  const decimalAdjustment = 10 ** (token0Decimals - token1Decimals);
  return price * decimalAdjustment;
}

// Cache for latest quotes
interface QuoteCache {
  price: number;
  liquidity: string;
  tick: number;
  ts: number;
  poolId: string;
}

const quoteCache: Map<string, QuoteCache> = new Map();

async function main() {
  log("info", "starting", { version: "3.0.0-v4-real" });

  const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
  const RPC_URL = process.env.RPC_URL || "https://eth.llamarpc.com";
  const HTTP_PORT = process.env.HTTP_PORT || "3002";

  // Pool IDs from environment (these are keccak256 hashes of pool keys)
  const CSR_POOL_ID = process.env.CSR_POOL_ID || "";
  const CSR25_POOL_ID = process.env.CSR25_POOL_ID || "";

  log("info", "config_loaded", {
    rpcUrl: RPC_URL.substring(0, 30) + "...",
    csrPoolId: CSR_POOL_ID ? CSR_POOL_ID.substring(0, 10) + "..." : "not_set",
    csr25PoolId: CSR25_POOL_ID
      ? CSR25_POOL_ID.substring(0, 10) + "..."
      : "not_set",
  });

  // Redis client for publishing market data
  const redisPub = new Redis(REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 50, 2000),
    maxRetriesPerRequest: 3,
  });

  redisPub.on("connect", () => log("info", "redis_connected"));
  redisPub.on("error", (err) =>
    log("error", "redis_error", { error: err.message })
  );

  // Viem public client for reading blockchain state
  const publicClient = createPublicClient({
    chain: mainnet,
    transport: viemHttp(RPC_URL),
  });

  // Fetch pool state from V4 StateView
  async function fetchPoolState(
    poolId: string,
    symbol: string
  ): Promise<QuoteCache | null> {
    if (!poolId || !poolId.startsWith("0x") || poolId.length !== 66) {
      return null;
    }

    try {
      const [slot0Result, liquidityResult] = await Promise.all([
        publicClient.readContract({
          address: STATE_VIEW_ADDRESS,
          abi: STATE_VIEW_ABI,
          functionName: "getSlot0",
          args: [poolId as `0x${string}`],
        }),
        publicClient.readContract({
          address: STATE_VIEW_ADDRESS,
          abi: STATE_VIEW_ABI,
          functionName: "getLiquidity",
          args: [poolId as `0x${string}`],
        }),
      ]);

      const [sqrtPriceX96, tick] = slot0Result as [
        bigint,
        number,
        number,
        number
      ];
      const liquidity = liquidityResult as bigint;

      // Calculate price (assuming token0 is the base token)
      // For CSR/USDT: price in USDT per CSR
      const price = sqrtPriceX96ToPrice(
        sqrtPriceX96,
        TOKENS.CSR.decimals,
        TOKENS.USDT.decimals
      );

      const quote: QuoteCache = {
        price,
        liquidity: liquidity.toString(),
        tick,
        ts: Date.now(),
        poolId,
      };

      quoteCache.set(symbol, quote);

      log("info", "pool_state_fetched", {
        symbol,
        price: price.toFixed(8),
        tick,
        liquidity: formatUnits(liquidity, 18),
      });

      return quote;
    } catch (err: any) {
      log("error", "fetch_pool_state_failed", {
        symbol,
        poolId,
        error: err.message,
      });
      return null;
    }
  }

  // Publish quote to Redis stream
  async function publishQuote(symbol: string, quote: QuoteCache) {
    if (redisPub.status !== "ready") return;

    const tick = {
      type: "uniswap.quote",
      eventId: uuidv4(),
      symbol,
      venue: "uniswap_v4",
      ts: new Date().toISOString(),
      effective_price_usdt: quote.price,
      liquidity: quote.liquidity,
      tick: quote.tick,
      poolId: quote.poolId,
      is_stale: false,
    };

    try {
      await redisPub.xadd("market:uniswap", "*", "data", JSON.stringify(tick));
      log("debug", "quote_published", { symbol, price: quote.price });
    } catch (err: any) {
      log("error", "publish_failed", { symbol, error: err.message });
    }
  }

  // Polling loop
  const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "5000", 10);

  const pools = [
    { symbol: "csr_usdt", id: CSR_POOL_ID, name: "CSR/USDT" },
    { symbol: "csr25_usdt", id: CSR25_POOL_ID, name: "CSR25/USDT" },
  ];

  async function pollPools() {
    for (const pool of pools) {
      const quote = await fetchPoolState(pool.id, pool.symbol);
      if (quote) {
        await publishQuote(pool.symbol, quote);
      }
    }
  }

  // Initial poll
  await pollPools();

  // Start polling interval
  setInterval(pollPools, POLL_INTERVAL);
  log("info", "polling_started", { interval: POLL_INTERVAL });

  // Health check HTTP server
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      const csrQuote = quoteCache.get("csr_usdt");
      const csr25Quote = quoteCache.get("csr25_usdt");
      const now = Date.now();
      const staleThreshold = 60000; // 60s

      const isHealthy = redisPub.status === "ready";
      const csrFresh = csrQuote && now - csrQuote.ts < staleThreshold;
      const csr25Fresh = csr25Quote && now - csr25Quote.ts < staleThreshold;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: isHealthy ? "healthy" : "degraded",
          service: "uniswap-v4-gateway",
          version: "3.0.0-v4-real",
          ts: new Date().toISOString(),
          quotes: {
            csr_usdt: csrQuote
              ? {
                  price: csrQuote.price,
                  age_ms: now - csrQuote.ts,
                  fresh: csrFresh,
                }
              : null,
            csr25_usdt: csr25Quote
              ? {
                  price: csr25Quote.price,
                  age_ms: now - csr25Quote.ts,
                  fresh: csr25Fresh,
                }
              : null,
          },
          redis: redisPub.status,
        })
      );
    } else if (req.url === "/quotes") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          csr_usdt: quoteCache.get("csr_usdt") || null,
          csr25_usdt: quoteCache.get("csr25_usdt") || null,
        })
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(parseInt(HTTP_PORT, 10), () => {
    log("info", "http_server_started", { port: HTTP_PORT });
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    log("info", "shutting_down");
    server.close();
    await redisPub.quit();
    process.exit(0);
  });
}

main().catch((err) => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});
