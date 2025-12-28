/**
 * CSR Arbitrage Monitoring Backend API
 * Node.js/TypeScript implementation aggregating microservices data
 */
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import * as http from 'http';
import process from "process";
import { WebSocket, WebSocketServer } from "ws";

// Use require for ethers to avoid TS module resolution issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ethers = require("ethers");

dotenv.config();

// Configuration
const PORT = parseInt(process.env.PORT || "8001");
const LBANK_GATEWAY_URL =
  process.env.LBANK_GATEWAY_URL || "http://localhost:3001";
const LATOKEN_GATEWAY_URL =
  process.env.LATOKEN_GATEWAY_URL || "http://localhost:3006";
const UNISWAP_QUOTE_URL =
  process.env.UNISWAP_QUOTE_URL || "http://localhost:3002";
const UNISWAP_QUOTE_CSR_URL =
  process.env.UNISWAP_QUOTE_CSR_URL || "http://localhost:3005";
const STRATEGY_ENGINE_URL =
  process.env.STRATEGY_ENGINE_URL || "http://localhost:3003";
const UNISWAP_SCRAPER_URL =
  process.env.UNISWAP_SCRAPER_URL || "http://localhost:3010";

// Types
interface ServiceHealth {
  service: string;
  status: string;
  ts: string;
  is_stale: boolean;
  connected: boolean;
  last_message_ts?: string;
  reconnect_count: number;
  errors_last_5m: number;
  subscription_errors?: Record<string, string>;
}

interface ScraperQuote {
  market: string;
  inputToken: string;
  outputToken: string;
  amountInUSDT: number;
  amountOutToken: string;
  effectivePriceUsdtPerToken: number;
  gasEstimateUsdt: number;
  route: string;
  ts: number;
  valid: boolean;
  reason?: string;
}

interface MarketData {
  lbank_ticker?: any;
  latoken_ticker?: any;
  uniswap_quote?: any;
  scraper_quotes?: ScraperQuote[];
  decision?: any;
}

interface DashboardData {
  ts: string;
  market_state?: {
    ts: string;
    csr_usdt: MarketData;
    csr25_usdt: MarketData;
    is_stale: boolean;
  };
  decision?: any;
  system_status: {
    ts: string;
    lbank_gateway: ServiceHealth;
    latoken_gateway: ServiceHealth;
    uniswap_quote_csr25: ServiceHealth;
    uniswap_quote_csr: ServiceHealth;
    strategy_engine: ServiceHealth;
    overall_status: string;
  };
  opportunities: any[];
}

// Global state
let dashboardData: DashboardData = {
  ts: new Date().toISOString(),
  system_status: {
    ts: new Date().toISOString(),
    lbank_gateway: {
      service: "lbank-gateway",
      status: "unknown",
      ts: new Date().toISOString(),
      is_stale: true,
      connected: false,
      reconnect_count: 0,
      errors_last_5m: 0,
    },
    latoken_gateway: {
      service: "latoken-gateway",
      status: "unknown",
      ts: new Date().toISOString(),
      is_stale: true,
      connected: false,
      reconnect_count: 0,
      errors_last_5m: 0,
    },
    uniswap_quote_csr25: {
      service: "uniswap-quote-csr25",
      status: "unknown",
      ts: new Date().toISOString(),
      is_stale: true,
      connected: false,
      reconnect_count: 0,
      errors_last_5m: 0,
    },
    uniswap_quote_csr: {
      service: "uniswap-quote-csr",
      status: "unknown",
      ts: new Date().toISOString(),
      is_stale: true,
      connected: false,
      reconnect_count: 0,
      errors_last_5m: 0,
    },
    strategy_engine: {
      service: "strategy",
      status: "unknown",
      ts: new Date().toISOString(),
      is_stale: true,
      connected: false,
      reconnect_count: 0,
      errors_last_5m: 0,
    },
    overall_status: "unknown",
  },
  opportunities: [],
};

const wsClients = new Set<WebSocket>();
const httpClient = axios.create({
  timeout: 5000,
});

// Price history storage (in-memory, last 100 points per market)
interface PricePoint {
  ts: string;
  cex_price: number;
  dex_price: number;
  spread_bps: number;
}

const priceHistory: {
  csr_usdt: PricePoint[];
  csr25_usdt: PricePoint[];
} = {
  csr_usdt: [],
  csr25_usdt: [],
};

const MAX_HISTORY_POINTS = 100;

function addPricePoint(market: "csr_usdt" | "csr25_usdt", point: PricePoint) {
  priceHistory[market].push(point);
  if (priceHistory[market].length > MAX_HISTORY_POINTS) {
    priceHistory[market].shift();
  }
}

// Fetch data from microservices
async function fetchServiceData() {
  try {
    const now = new Date().toISOString();

    // Fetch LBank Gateway health
    let lbankHealth: ServiceHealth | undefined;
    try {
      const resp = await httpClient.get(`${LBANK_GATEWAY_URL}/ready`);
      const data = resp.data;
      lbankHealth = {
        service: "lbank-gateway",
        status: data.status || "unknown",
        ts: data.ts || now,
        is_stale: data.is_stale || false,
        connected: data.connected || false,
        last_message_ts: data.last_message_ts,
        reconnect_count: data.reconnect_count || 0,
        errors_last_5m: data.errors_last_5m || 0,
        subscription_errors: data.subscription_errors || undefined,
      };
    } catch {
      lbankHealth = {
        service: "lbank-gateway",
        status: "error",
        ts: now,
        is_stale: true,
        connected: false,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    }

    // Fetch LATOKEN Gateway health
    let latokenHealth: ServiceHealth;
    try {
      const resp = await httpClient.get(`${LATOKEN_GATEWAY_URL}/ready`);
      const data = resp.data;
      latokenHealth = {
        service: "latoken-gateway",
        status: data.status || "unknown",
        ts: data.ts || now,
        is_stale: data.is_stale || false,
        connected: data.running || false,
        last_message_ts: data.last_data_ts,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    } catch {
      latokenHealth = {
        service: "latoken-gateway",
        status: "error",
        ts: now,
        is_stale: true,
        connected: false,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    }

    // Fetch Uniswap Quote health for CSR25
    let uniswapHealthCSR25: ServiceHealth | undefined;
    try {
      const resp = await httpClient.get(`${UNISWAP_QUOTE_URL}/health`);
      const data = resp.data;
      uniswapHealthCSR25 = {
        service: "uniswap-quote-csr25",
        status: data.status || "ok",
        ts: data.ts || now,
        is_stale: false,
        connected: true,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    } catch {
      uniswapHealthCSR25 = {
        service: "uniswap-quote-csr25",
        status: "error",
        ts: now,
        is_stale: true,
        connected: false,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    }

    // Fetch Uniswap Quote health for CSR
    let uniswapHealthCSR: ServiceHealth | undefined;
    try {
      const resp = await httpClient.get(`${UNISWAP_QUOTE_CSR_URL}/health`);
      const data = resp.data;
      uniswapHealthCSR = {
        service: "uniswap-quote-csr",
        status: data.status || "ok",
        ts: data.ts || now,
        is_stale: false,
        connected: true,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    } catch {
      uniswapHealthCSR = {
        service: "uniswap-quote-csr",
        status: "error",
        ts: now,
        is_stale: true,
        connected: false,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    }

    // Fetch Strategy Engine data
    let strategyHealth: ServiceHealth | undefined;
    let marketState: any;
    let decision: any;

    try {
      const resp = await httpClient.get(`${STRATEGY_ENGINE_URL}/health`);
      const data = resp.data;
      strategyHealth = {
        service: "strategy",
        status: data.status || "ok",
        ts: data.ts || now,
        is_stale: false,
        connected: true,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    } catch {
      strategyHealth = {
        service: "strategy",
        status: "error",
        ts: now,
        is_stale: true,
        connected: false,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    }

    // Fetch scraper quotes (UI-scraped V4 prices)
    let scraperQuotes: { CSR: ScraperQuote[]; CSR25: ScraperQuote[] } = {
      CSR: [],
      CSR25: [],
    };
    try {
      const resp = await httpClient.get(`${UNISWAP_SCRAPER_URL}/quotes`);
      if (resp.data?.quotes) {
        for (const quote of resp.data.quotes) {
          if (quote.outputToken === "CSR") {
            scraperQuotes.CSR.push(quote);
          } else if (quote.outputToken === "CSR25") {
            scraperQuotes.CSR25.push(quote);
          }
        }
      }
    } catch {
      // Scraper not available - continue without scraper quotes
    }

    // Fetch market state from strategy engine (includes both markets)
    try {
      const resp = await httpClient.get(`${STRATEGY_ENGINE_URL}/state`);
      marketState = resp.data;
      // Add scraper quotes to market state
      if (marketState.csr_usdt) {
        marketState.csr_usdt.scraper_quotes = scraperQuotes.CSR;
      }
      if (marketState.csr25_usdt) {
        marketState.csr25_usdt.scraper_quotes = scraperQuotes.CSR25;
      }
    } catch {
      // Use default structure if strategy engine is down
      marketState = {
        ts: now,
        csr_usdt: {
          lbank_ticker: null,
          uniswap_quote: null,
          decision: null,
          scraper_quotes: scraperQuotes.CSR,
        },
        csr25_usdt: {
          lbank_ticker: null,
          uniswap_quote: null,
          decision: null,
          scraper_quotes: scraperQuotes.CSR25,
        },
        is_stale: true,
      };
    }

    try {
      const resp = await httpClient.get(`${STRATEGY_ENGINE_URL}/decision`);
      if (!resp.data.error) {
        decision = resp.data;
      }
    } catch {
      // Ignore errors
    }

    // Determine overall status
    const statuses = [
      lbankHealth?.status || "error",
      latokenHealth?.status || "error",
      uniswapHealthCSR25?.status || "error",
      uniswapHealthCSR?.status || "error",
      strategyHealth?.status || "error",
    ];

    let overall = "unknown";
    if (statuses.every((s) => s === "ok" || s === "healthy")) {
      overall = "healthy";
    } else if (statuses.some((s) => s === "error")) {
      overall = "degraded";
    }

    // Build opportunities from both markets
    const opportunities: any[] = [];
    if (decision?.csr_usdt?.would_trade) {
      opportunities.push(decision.csr_usdt);
    }
    if (decision?.csr25_usdt?.would_trade) {
      opportunities.push(decision.csr25_usdt);
    }

    // Record price history for charts
    if (marketState) {
      // CSR/USDT - use LATOKEN as CEX source
      const csrCex = marketState.csr_usdt?.latoken_ticker;
      const csrDex = marketState.csr_usdt?.uniswap_quote;
      if (csrCex?.bid && csrDex?.effective_price_usdt) {
        const cexMid = (csrCex.bid + csrCex.ask) / 2;
        const spreadBps =
          ((cexMid - csrDex.effective_price_usdt) /
            csrDex.effective_price_usdt) *
          10000;
        addPricePoint("csr_usdt", {
          ts: now,
          cex_price: cexMid,
          dex_price: csrDex.effective_price_usdt,
          spread_bps: Math.round(spreadBps * 100) / 100,
        });
      }
      // CSR25/USDT - use LBANK as CEX source
      const csr25Cex = marketState.csr25_usdt?.lbank_ticker;
      const csr25Dex = marketState.csr25_usdt?.uniswap_quote;
      if (csr25Cex?.bid && csr25Dex?.effective_price_usdt) {
        const cexMid = (csr25Cex.bid + csr25Cex.ask) / 2;
        const spreadBps =
          ((cexMid - csr25Dex.effective_price_usdt) /
            csr25Dex.effective_price_usdt) *
          10000;
        addPricePoint("csr25_usdt", {
          ts: now,
          cex_price: cexMid,
          dex_price: csr25Dex.effective_price_usdt,
          spread_bps: Math.round(spreadBps * 100) / 100,
        });
      }
    }

    // Update dashboard data
    dashboardData = {
      ts: now,
      market_state: marketState,
      decision: decision,
      system_status: {
        ts: now,
        lbank_gateway: lbankHealth,
        latoken_gateway: latokenHealth,
        uniswap_quote_csr25: uniswapHealthCSR25,
        uniswap_quote_csr: uniswapHealthCSR,
        strategy_engine: strategyHealth,
        overall_status: overall,
      },
      opportunities,
    };

    // Broadcast to WebSocket clients
    if (wsClients.size > 0) {
      const message = JSON.stringify(dashboardData);
      wsClients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  } catch (error) {
    console.error("Error fetching service data:", error);
  }
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// HTTP Routes
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "csr-arbitrage-api",
    ts: new Date().toISOString(),
  });
});

app.get("/api/dashboard", (req, res) => {
  res.json(dashboardData);
});

// Price history API for charts
app.get("/api/history/:market", (req, res) => {
  const market = req.params.market as "csr_usdt" | "csr25_usdt";
  if (market !== "csr_usdt" && market !== "csr25_usdt") {
    return res
      .status(400)
      .json({ error: "Invalid market. Use csr_usdt or csr25_usdt" });
  }
  res.json({
    market,
    points: priceHistory[market],
    count: priceHistory[market].length,
  });
});

// Orchestrator API: /api/state - unified market state
app.get("/api/state", (req, res) => {
  const state = {
    ts: dashboardData.ts,
    markets: {
      csr_usdt: {
        lbank: dashboardData.market_state?.csr_usdt?.lbank_ticker || null,
        uniswap: dashboardData.market_state?.csr_usdt?.uniswap_quote || null,
        decision: dashboardData.market_state?.csr_usdt?.decision || null,
        freshness: {
          lbank_age_ms: dashboardData.market_state?.csr_usdt?.lbank_ticker?.ts
            ? Date.now() -
              new Date(
                dashboardData.market_state.csr_usdt.lbank_ticker.ts
              ).getTime()
            : null,
          uniswap_age_ms: dashboardData.market_state?.csr_usdt?.uniswap_quote
            ?.ts
            ? Date.now() -
              new Date(
                dashboardData.market_state.csr_usdt.uniswap_quote.ts
              ).getTime()
            : null,
        },
      },
      csr25_usdt: {
        lbank: dashboardData.market_state?.csr25_usdt?.lbank_ticker || null,
        uniswap: dashboardData.market_state?.csr25_usdt?.uniswap_quote || null,
        decision: dashboardData.market_state?.csr25_usdt?.decision || null,
        freshness: {
          lbank_age_ms: dashboardData.market_state?.csr25_usdt?.lbank_ticker?.ts
            ? Date.now() -
              new Date(
                dashboardData.market_state.csr25_usdt.lbank_ticker.ts
              ).getTime()
            : null,
          uniswap_age_ms: dashboardData.market_state?.csr25_usdt?.uniswap_quote
            ?.ts
            ? Date.now() -
              new Date(
                dashboardData.market_state.csr25_usdt.uniswap_quote.ts
              ).getTime()
            : null,
        },
      },
    },
    opportunities: dashboardData.opportunities,
  };
  res.json(state);
});

// Orchestrator API: /api/health - aggregated health
app.get("/api/health", (req, res) => {
  res.json(dashboardData.system_status);
});

// Orchestrator API: /api/config - sanitized config (no secrets)
app.get("/api/config", (req, res) => {
  res.json({
    execution_mode: process.env.EXECUTION_MODE || "off",
    kill_switch: process.env.KILL_SWITCH === "true",
    max_order_usdt: parseFloat(process.env.MAX_ORDER_USDT || "1000"),
    max_daily_volume_usdt: parseFloat(
      process.env.MAX_DAILY_VOLUME_USDT || "10000"
    ),
    min_edge_bps: parseFloat(process.env.MIN_EDGE_BPS || "50"),
    max_slippage_bps: parseFloat(process.env.MAX_SLIPPAGE_BPS || "100"),
    max_staleness_seconds: parseFloat(
      process.env.MAX_STALENESS_SECONDS || "30"
    ),
    max_concurrent_orders: parseInt(process.env.MAX_CONCURRENT_ORDERS || "1"),
    symbols: ["csr_usdt", "csr25_usdt"],
  });
});

// Scraper quotes proxy endpoint
app.get("/api/scraper/quotes", async (req, res) => {
  try {
    const response = await axios.get(`${UNISWAP_SCRAPER_URL}/quotes`, {
      timeout: 5000,
    });
    res.json(response.data);
  } catch (error: any) {
    console.error("Failed to fetch scraper quotes:", error.message);
    res.status(502).json({
      error: "Scraper unavailable",
      details: error.message,
      quotes: [],
      meta: { lastSuccessTs: null, errorsLast5m: 0 },
    });
  }
});

// ============================================================
// /api/alignment - AUTHORITATIVE endpoint for required trade sizes
// Uses LADDER QUOTES ONLY. Never invents sizes. Small-to-large approach.
// ============================================================

interface AlignmentResult {
  market: string;
  cex_mid: number | null;
  dex_exec_price: number | null;
  dex_quote_size_usdt: number | null;
  deviation_pct: number | null;
  band_bps: number;
  status:
    | "ALIGNED"
    | "BUY_ON_DEX"
    | "SELL_ON_DEX"
    | "NO_ACTION"
    | "NOT_SUPPORTED_YET";
  direction: "BUY" | "SELL" | "NONE";
  required_usdt: number | null;
  required_tokens: number | null;
  expected_exec_price: number | null;
  price_impact_pct: number | null;
  network_cost_usd: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  ts_cex: string | null;
  ts_dex: number | null;
  reason: string;
  quotes_available: number;
  quotes_valid: number;
}

// Alignment bands per token (in basis points)
const ALIGNMENT_BANDS: Record<string, number> = {
  csr_usdt: 50, // ±0.5% for CSR
  csr25_usdt: 100, // ±1.0% for CSR25
};

// Max price impact caps - must be higher than typical needed_move to allow selection
const MAX_IMPACT_CAPS: Record<string, number> = {
  csr_usdt: 15.0, // allow up to 15% impact for CSR
  csr25_usdt: 15.0, // allow up to 15% impact for CSR25
};

// Max gas as % of trade (gas gating)
const MAX_GAS_BPS: Record<string, number> = {
  csr_usdt: 500, // 5% max gas for CSR
  csr25_usdt: 500, // 5% max gas for CSR25
};

// Freshness thresholds - per source
const CEX_STALE_SEC = 120; // 2 minutes for CEX (should update frequently)
const DEX_STALE_SEC = 180; // 3 minutes for DEX (scraper cycle is ~2 min)

app.get("/api/alignment/:market", async (req, res) => {
  const market = req.params.market.toLowerCase();

  if (market !== "csr_usdt" && market !== "csr25_usdt") {
    return res
      .status(400)
      .json({ error: "Invalid market. Use csr_usdt or csr25_usdt" });
  }

  const bandBps = ALIGNMENT_BANDS[market];
  const maxImpactCap = MAX_IMPACT_CAPS[market];
  const maxGasBps = MAX_GAS_BPS[market];
  const now = Date.now();

  // Initialize result with defaults
  const result: AlignmentResult = {
    market,
    cex_mid: null,
    dex_exec_price: null,
    dex_quote_size_usdt: null,
    deviation_pct: null,
    band_bps: bandBps,
    status: "NO_ACTION",
    direction: "NONE",
    required_usdt: null,
    required_tokens: null,
    expected_exec_price: null,
    price_impact_pct: null,
    network_cost_usd: null,
    confidence: "NONE",
    ts_cex: null,
    ts_dex: null,
    reason: "",
    quotes_available: 0,
    quotes_valid: 0,
  };

  try {
    // 1. Get CEX mid price
    let cexMid: number | null = null;
    let cexTs: string | null = null;

    if (market === "csr_usdt") {
      const latoken = dashboardData.market_state?.csr_usdt?.latoken_ticker;
      if (latoken?.bid && latoken?.ask) {
        cexMid = (latoken.bid + latoken.ask) / 2;
        cexTs = latoken.ts;
      }
    } else {
      const lbank = dashboardData.market_state?.csr25_usdt?.lbank_ticker;
      if (lbank?.bid && lbank?.ask) {
        cexMid = (lbank.bid + lbank.ask) / 2;
        cexTs = lbank.ts;
      }
    }

    result.cex_mid = cexMid;
    result.ts_cex = cexTs;

    if (!cexMid || !cexTs) {
      result.reason = "cex_data_missing";
      return res.json(result);
    }

    const cexAgeSec = (now - new Date(cexTs).getTime()) / 1000;
    if (cexAgeSec > CEX_STALE_SEC) {
      result.reason = `cex_stale: ${Math.round(
        cexAgeSec
      )}s > ${CEX_STALE_SEC}s`;
      return res.json(result);
    }

    // 2. Get DEX quotes from scraper
    let scraperQuotes: any[] = [];
    try {
      const token = market === "csr_usdt" ? "CSR" : "CSR25";
      const scraperResp = await axios.get(
        `${UNISWAP_SCRAPER_URL}/quotes/${token}`,
        { timeout: 5000 }
      );
      scraperQuotes = scraperResp.data?.quotes || [];
    } catch {
      result.reason = "scraper_unavailable";
      return res.json(result);
    }

    result.quotes_available = scraperQuotes.length;
    const validQuotes = scraperQuotes.filter(
      (q: any) => q.valid && q.price_usdt_per_token > 0
    );
    result.quotes_valid = validQuotes.length;

    if (validQuotes.length === 0) {
      result.reason = "no_valid_dex_quotes";
      return res.json(result);
    }

    // Check DEX freshness
    const latestQuote = validQuotes.reduce((a: any, b: any) =>
      a.ts > b.ts ? a : b
    );
    result.ts_dex = latestQuote.ts;
    const dexAgeSec = now / 1000 - latestQuote.ts;
    if (dexAgeSec > DEX_STALE_SEC) {
      result.reason = `dex_stale: ${Math.round(
        dexAgeSec
      )}s > ${DEX_STALE_SEC}s`;
      return res.json(result);
    }

    // 3. Sort quotes by size (small to large) - CRITICAL for finding smallest sufficient
    validQuotes.sort((a: any, b: any) => a.amountInUSDT - b.amountInUSDT);

    // 4. Get smallest valid quote as baseline DEX price (P0)
    const smallestQuote = validQuotes[0];
    const spotPrice = smallestQuote.price_usdt_per_token; // P0
    result.dex_exec_price = spotPrice;
    result.dex_quote_size_usdt = smallestQuote.amountInUSDT;

    // 5. Calculate gap: gap_pct = (P0 - P_cex) / P_cex
    // Positive = DEX higher than CEX, Negative = DEX lower than CEX
    const gapPct = ((spotPrice - cexMid) / cexMid) * 100;
    result.deviation_pct = Math.round(gapPct * 100) / 100;
    const bandPct = bandBps / 100;

    // 6. Check if already aligned (within band)
    if (Math.abs(gapPct) <= bandPct) {
      result.status = "ALIGNED";
      result.direction = "NONE";
      result.reason = `within_band: ${result.deviation_pct}% vs ±${bandPct}%`;
      result.confidence = "HIGH";
      return res.json(result);
    }

    // 7. Determine direction based on gap
    // gap_pct > band_pct => DEX expensive => need SELL on DEX (push price down)
    // gap_pct < -band_pct => DEX cheap => need BUY on DEX (push price up)
    if (gapPct > bandPct) {
      result.direction = "SELL";
      result.status = "SELL_ON_DEX";
      result.reason = "sell_quoting_not_implemented_yet";
      return res.json(result);
    }

    // DEX is cheap -> BUY on DEX to push price up
    result.direction = "BUY";
    result.status = "BUY_ON_DEX";

    // 8. CORRECT ALGORITHM: Find EXACT trade size by interpolating between ladder points
    // need_move_pct = max(0, |gap_pct| - band_pct)
    const neededMovePct = Math.max(0, Math.abs(gapPct) - bandPct);

    // Filter to fresh, valid quotes and compute impact for each
    const freshQuotes = validQuotes
      .filter((q: any) => {
        const quoteAge = now / 1000 - q.ts;
        return quoteAge <= DEX_STALE_SEC;
      })
      .map((q: any) => ({
        ...q,
        impactPct: Math.abs(
          ((q.price_usdt_per_token - spotPrice) / spotPrice) * 100
        ),
      }))
      .filter((q: any) => q.impactPct <= maxImpactCap); // Filter out quotes exceeding impact cap

    if (freshQuotes.length === 0) {
      result.required_usdt = null;
      result.required_tokens = null;
      result.expected_exec_price = null;
      result.price_impact_pct = null;
      result.network_cost_usd = null;
      result.confidence = "NONE";
      result.reason = `no_fresh_quotes: all quotes stale (> ${DEX_STALE_SEC}s) or exceed impact cap`;
      return res.json(result);
    }

    // Find the two quotes that bracket the needed impact for interpolation
    let lowerQuote: any = null;
    let upperQuote: any = null;

    for (let i = 0; i < freshQuotes.length; i++) {
      const q = freshQuotes[i];
      if (q.impactPct >= neededMovePct) {
        upperQuote = q;
        lowerQuote = i > 0 ? freshQuotes[i - 1] : null;
        break;
      }
    }

    let exactUsdt: number;
    let exactTokens: number;
    let exactPrice: number;
    let exactImpact: number;
    let selectionReason: string;

    if (upperQuote && lowerQuote && lowerQuote.impactPct < neededMovePct) {
      // Interpolate between the two quotes to find exact size
      // Linear interpolation: usdt = lower + (upper - lower) * (need - lowerImpact) / (upperImpact - lowerImpact)
      const impactRange = upperQuote.impactPct - lowerQuote.impactPct;
      const usdtRange = upperQuote.amountInUSDT - lowerQuote.amountInUSDT;
      const impactNeededFromLower = neededMovePct - lowerQuote.impactPct;

      const interpolationFactor = impactNeededFromLower / impactRange;
      exactUsdt = lowerQuote.amountInUSDT + usdtRange * interpolationFactor;

      // Round to 2 decimal places (cents)
      exactUsdt = Math.round(exactUsdt * 100) / 100;

      // Interpolate tokens and price proportionally
      const tokenRange = upperQuote.amountOutToken - lowerQuote.amountOutToken;
      exactTokens =
        lowerQuote.amountOutToken + tokenRange * interpolationFactor;

      exactPrice = exactUsdt / exactTokens;
      exactImpact = neededMovePct;

      selectionReason = `interpolated: $${exactUsdt.toFixed(2)} between $${
        lowerQuote.amountInUSDT
      } and $${upperQuote.amountInUSDT} for ${neededMovePct.toFixed(
        2
      )}% impact`;
    } else if (upperQuote) {
      // Use the first quote that exceeds needed impact (no lower bound to interpolate from)
      exactUsdt = upperQuote.amountInUSDT;
      exactTokens = upperQuote.amountOutToken;
      exactPrice = upperQuote.price_usdt_per_token;
      exactImpact = upperQuote.impactPct;
      selectionReason = `first_sufficient: $${exactUsdt} has impact ${exactImpact.toFixed(
        2
      )}% >= need ${neededMovePct.toFixed(2)}%`;
    } else {
      // No quote has enough impact
      result.required_usdt = null;
      result.required_tokens = null;
      result.expected_exec_price = null;
      result.price_impact_pct = null;
      result.network_cost_usd = null;
      result.confidence = "NONE";
      result.reason = `no_safe_size: need ${neededMovePct.toFixed(
        2
      )}% move, max available impact insufficient`;
      return res.json(result);
    }

    // Populate result with computed exact values
    result.required_usdt = exactUsdt;
    result.required_tokens = Math.round(exactTokens * 100) / 100;
    result.expected_exec_price = exactPrice;
    result.price_impact_pct = Math.round(exactImpact * 100) / 100;

    // Gas from upper quote (closest reference)
    result.network_cost_usd = upperQuote?.gasEstimateUsdt ?? null;

    // Confidence based on data quality
    result.confidence =
      validQuotes.length >= 5
        ? "HIGH"
        : validQuotes.length >= 3
        ? "MEDIUM"
        : "LOW";

    // Build reason string showing WHY this size was chosen
    result.reason = selectionReason;

    return res.json(result);
  } catch (error: any) {
    result.reason = `error: ${error.message}`;
    return res.json(result);
  }
});

// Alignment for all markets
app.get("/api/alignment", async (req, res) => {
  try {
    const [csrResp, csr25Resp] = await Promise.all([
      axios.get(`http://localhost:${PORT}/api/alignment/csr_usdt`),
      axios.get(`http://localhost:${PORT}/api/alignment/csr25_usdt`),
    ]);
    res.json({
      ts: new Date().toISOString(),
      csr_usdt: csrResp.data,
      csr25_usdt: csr25Resp.data,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DEBUG endpoint - shows full computation details
app.get("/api/alignment/debug/:market", async (req, res) => {
  const market = req.params.market.toLowerCase();
  if (market !== "csr_usdt" && market !== "csr25_usdt") {
    return res.status(400).json({ error: "Invalid market" });
  }

  const bandBps = ALIGNMENT_BANDS[market];
  const maxImpactCap = MAX_IMPACT_CAPS[market];
  const maxGasBps = MAX_GAS_BPS[market];
  const bandPct = bandBps / 100;
  const now = Date.now();

  const debug: any = {
    market,
    config: { bandBps, bandPct, maxImpactCap, maxGasBps },
    cex: { mid: null, source: null, age_sec: null },
    dex: { spot_price: null, source_size: null },
    computed: { gap_pct: null, need_move_pct: null, direction: null },
    ladder_analysis: [],
    selection: { chosen_size: null, reason: null, fallback_used: false },
  };

  try {
    // Get CEX price
    let cexMid: number | null = null;
    let cexTs: string | null = null;

    if (market === "csr_usdt") {
      const latoken = dashboardData.market_state?.csr_usdt?.latoken_ticker;
      if (latoken?.bid && latoken?.ask) {
        cexMid = (latoken.bid + latoken.ask) / 2;
        cexTs = latoken.ts;
        debug.cex.source = "latoken";
      }
    } else {
      const lbank = dashboardData.market_state?.csr25_usdt?.lbank_ticker;
      if (lbank?.bid && lbank?.ask) {
        cexMid = (lbank.bid + lbank.ask) / 2;
        cexTs = lbank.ts;
        debug.cex.source = "lbank";
      }
    }

    debug.cex.mid = cexMid;
    if (cexTs) {
      debug.cex.age_sec = Math.round((now - new Date(cexTs).getTime()) / 1000);
    }

    if (!cexMid) {
      debug.selection.reason = "cex_data_missing";
      return res.json(debug);
    }

    // Get DEX quotes
    const token = market === "csr_usdt" ? "CSR" : "CSR25";
    let scraperQuotes: any[] = [];
    try {
      const scraperResp = await axios.get(
        `${UNISWAP_SCRAPER_URL}/quotes/${token}`,
        { timeout: 5000 }
      );
      scraperQuotes = scraperResp.data?.quotes || [];
    } catch {
      debug.selection.reason = "scraper_unavailable";
      return res.json(debug);
    }

    const validQuotes = scraperQuotes
      .filter((q: any) => q.valid && q.price_usdt_per_token > 0)
      .sort((a: any, b: any) => a.amountInUSDT - b.amountInUSDT);

    if (validQuotes.length === 0) {
      debug.selection.reason = "no_valid_quotes";
      return res.json(debug);
    }

    // Compute baseline
    const spotPrice = validQuotes[0].price_usdt_per_token;
    debug.dex.spot_price = spotPrice;
    debug.dex.source_size = validQuotes[0].amountInUSDT;

    const gapPct = ((spotPrice - cexMid) / cexMid) * 100;
    const neededMovePct = Math.max(0, Math.abs(gapPct) - bandPct);

    debug.computed.gap_pct = Math.round(gapPct * 100) / 100;
    debug.computed.need_move_pct = Math.round(neededMovePct * 100) / 100;
    debug.computed.direction =
      gapPct > bandPct ? "SELL" : gapPct < -bandPct ? "BUY" : "ALIGNED";

    // Analyze each ladder quote
    let selectedQuote: any = null;
    for (const quote of validQuotes) {
      const quoteAge = now / 1000 - quote.ts;
      const impactPct = Math.abs(
        ((quote.price_usdt_per_token - spotPrice) / spotPrice) * 100
      );
      const gasBps = quote.gasEstimateUsdt
        ? (quote.gasEstimateUsdt / quote.amountInUSDT) * 10000
        : null;

      const analysis: any = {
        usdt: quote.amountInUSDT,
        exec_price: quote.price_usdt_per_token,
        impact_pct: Math.round(impactPct * 100) / 100,
        gas_usdt: quote.gasEstimateUsdt,
        gas_bps: gasBps ? Math.round(gasBps) : null,
        age_sec: Math.round(quoteAge),
        skipped: null,
        sufficient: impactPct >= neededMovePct,
      };

      // Check skip reasons
      if (quoteAge > DEX_STALE_SEC) {
        analysis.skipped = `stale (> ${DEX_STALE_SEC}s)`;
      } else if (impactPct > maxImpactCap) {
        analysis.skipped = `impact ${impactPct.toFixed(
          1
        )}% > cap ${maxImpactCap}%`;
      } else if (gasBps && gasBps > maxGasBps) {
        analysis.skipped = `gas ${gasBps}bps > cap ${maxGasBps}bps`;
      } else if (!selectedQuote && impactPct >= neededMovePct) {
        analysis.skipped = null;
        analysis.chosen = true;
        selectedQuote = quote;
        debug.selection.chosen_size = quote.amountInUSDT;
        debug.selection.reason = `impact ${impactPct.toFixed(
          2
        )}% >= need ${neededMovePct.toFixed(2)}%`;
      }

      debug.ladder_analysis.push(analysis);
    }

    if (!selectedQuote) {
      debug.selection.chosen_size = null;
      debug.selection.reason = `no_safe_size: all quotes either stale, impact > ${maxImpactCap}%, or insufficient impact`;
      debug.selection.fallback_used = false;
    }

    return res.json(debug);
  } catch (error: any) {
    debug.selection.reason = `error: ${error.message}`;
    return res.json(debug);
  }
});

// DEBUG: Raw timestamps endpoint to diagnose ms-vs-sec and clock skew issues
app.get("/api/debug/timestamps", async (_req, res) => {
  const now = Date.now();
  const nowDate = new Date(now);

  // Get CEX timestamps
  const latokenTicker = dashboardData.market_state?.csr_usdt?.latoken_ticker;
  const lbankTicker = dashboardData.market_state?.csr25_usdt?.lbank_ticker;

  // Get DEX timestamps from scraper
  let csrDexTs: number | null = null;
  let csr25DexTs: number | null = null;

  try {
    const [csrResp, csr25Resp] = await Promise.all([
      axios
        .get(`${UNISWAP_SCRAPER_URL}/quotes/CSR`, { timeout: 3000 })
        .catch(() => null),
      axios
        .get(`${UNISWAP_SCRAPER_URL}/quotes/CSR25`, { timeout: 3000 })
        .catch(() => null),
    ]);

    if (csrResp?.data?.quotes?.length) {
      const latestCsr = csrResp.data.quotes.reduce((a: any, b: any) =>
        a.ts > b.ts ? a : b
      );
      csrDexTs = latestCsr.ts;
    }
    if (csr25Resp?.data?.quotes?.length) {
      const latestCsr25 = csr25Resp.data.quotes.reduce((a: any, b: any) =>
        a.ts > b.ts ? a : b
      );
      csr25DexTs = latestCsr25.ts;
    }
  } catch {
    // Ignore scraper errors
  }

  const result = {
    server: {
      now_ms: now,
      now_sec: Math.floor(now / 1000),
      now_iso: nowDate.toISOString(),
    },
    cex: {
      csr_latoken: {
        raw_ts: latokenTicker?.ts || null,
        parsed_date: latokenTicker?.ts
          ? new Date(latokenTicker.ts).toISOString()
          : null,
        age_sec: latokenTicker?.ts
          ? Math.round((now - new Date(latokenTicker.ts).getTime()) / 1000)
          : null,
        stale_threshold_sec: CEX_STALE_SEC,
        is_stale: latokenTicker?.ts
          ? (now - new Date(latokenTicker.ts).getTime()) / 1000 > CEX_STALE_SEC
          : true,
      },
      csr25_lbank: {
        raw_ts: lbankTicker?.ts || null,
        parsed_date: lbankTicker?.ts
          ? new Date(lbankTicker.ts).toISOString()
          : null,
        age_sec: lbankTicker?.ts
          ? Math.round((now - new Date(lbankTicker.ts).getTime()) / 1000)
          : null,
        stale_threshold_sec: CEX_STALE_SEC,
        is_stale: lbankTicker?.ts
          ? (now - new Date(lbankTicker.ts).getTime()) / 1000 > CEX_STALE_SEC
          : true,
      },
    },
    dex: {
      csr: {
        raw_ts: csrDexTs,
        is_seconds: csrDexTs && csrDexTs < 2000000000, // Unix seconds vs milliseconds detection
        parsed_date: csrDexTs
          ? csrDexTs < 2000000000
            ? new Date(csrDexTs * 1000).toISOString()
            : new Date(csrDexTs).toISOString()
          : null,
        age_sec: csrDexTs
          ? csrDexTs < 2000000000
            ? Math.round(now / 1000 - csrDexTs)
            : Math.round((now - csrDexTs) / 1000)
          : null,
        stale_threshold_sec: DEX_STALE_SEC,
      },
      csr25: {
        raw_ts: csr25DexTs,
        is_seconds: csr25DexTs && csr25DexTs < 2000000000,
        parsed_date: csr25DexTs
          ? csr25DexTs < 2000000000
            ? new Date(csr25DexTs * 1000).toISOString()
            : new Date(csr25DexTs).toISOString()
          : null,
        age_sec: csr25DexTs
          ? csr25DexTs < 2000000000
            ? Math.round(now / 1000 - csr25DexTs)
            : Math.round((now - csr25DexTs) / 1000)
          : null,
        stale_threshold_sec: DEX_STALE_SEC,
      },
    },
  };

  res.json(result);
});

// Quote ladder endpoint - returns all trade simulations for display
app.get("/api/ladder/:token", async (req, res) => {
  const token = req.params.token.toUpperCase();
  if (token !== "CSR" && token !== "CSR25") {
    return res.status(400).json({ error: "Invalid token. Use CSR or CSR25" });
  }

  try {
    const scraperResp = await axios.get(
      `${UNISWAP_SCRAPER_URL}/quotes/${token}`,
      { timeout: 5000 }
    );
    const quotes = scraperResp.data?.quotes || [];
    const now = Date.now();

    // Get CEX mid for deviation calculation
    let cexMid: number | null = null;
    if (token === "CSR") {
      const latoken = dashboardData.market_state?.csr_usdt?.latoken_ticker;
      if (latoken?.bid && latoken?.ask) {
        cexMid = (latoken.bid + latoken.ask) / 2;
      }
    } else {
      const lbank = dashboardData.market_state?.csr25_usdt?.lbank_ticker;
      if (lbank?.bid && lbank?.ask) {
        cexMid = (lbank.bid + lbank.ask) / 2;
      }
    }

    // Get spot price from smallest valid quote
    const validQuotes = quotes.filter(
      (q: any) => q.valid && q.price_usdt_per_token > 0
    );
    const spotPrice =
      validQuotes.length > 0
        ? validQuotes.reduce((a: any, b: any) =>
            a.amountInUSDT < b.amountInUSDT ? a : b
          ).price_usdt_per_token
        : null;

    // Enrich quotes with calculated fields
    const enrichedQuotes = quotes.map((q: any) => {
      const ageSeconds = q.ts ? Math.round(now / 1000 - q.ts) : null;
      const impactPct =
        spotPrice && q.price_usdt_per_token > 0
          ? ((q.price_usdt_per_token - spotPrice) / spotPrice) * 100
          : null;
      const deviationPct =
        cexMid && q.price_usdt_per_token > 0
          ? ((q.price_usdt_per_token - cexMid) / cexMid) * 100
          : null;

      return {
        usdt_in: q.amountInUSDT,
        tokens_out: q.amountOutToken,
        exec_price: q.price_usdt_per_token,
        price_impact_pct:
          impactPct !== null ? Math.round(impactPct * 100) / 100 : null,
        deviation_pct:
          deviationPct !== null ? Math.round(deviationPct * 100) / 100 : null,
        gas_usdt: q.gasEstimateUsdt || null,
        age_seconds: ageSeconds,
        valid: q.valid,
        error: q.error || null,
      };
    });

    res.json({
      token,
      cex_mid: cexMid,
      spot_price: spotPrice,
      quotes: enrichedQuotes,
      total: quotes.length,
      valid: validQuotes.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/market", (req, res) => {
  res.json(dashboardData.market_state);
});

// ============================================================================
// Token Swap History - Using Etherscan API for full history
// ============================================================================

// Token contract addresses
const TOKEN_ADDRESSES: Record<string, string> = {
  CSR: "0x75Ecb52e403C617679FBd3e77A50f9d10A842387",
  CSR25: "0x502E7230E142A332DFEd1095F7174834b2548982",
};

// USDT address for identifying swap direction
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7".toLowerCase();

// Known DEX router/pool addresses to filter swaps
const DEX_ADDRESSES = new Set([
  "0x000000000004444c5dc75cb358380d2e3de08a90", // Uniswap v4 PoolManager
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap Universal Router
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap SwapRouter02
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 SwapRouter
].map(a => a.toLowerCase()));

// Cache for swaps (60s TTL - longer since this is historical data)
interface SwapCache {
  data: any[];
  timestamp: number;
}
const swapCache: Record<string, SwapCache> = {};
const SWAP_CACHE_TTL_MS = 60000;

// Etherscan API key (free tier: 5 calls/sec)
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";

// Get token transfer history from Etherscan
app.get("/api/swaps/:token", async (req, res) => {
  const token = req.params.token.toUpperCase();

  if (token !== "CSR" && token !== "CSR25") {
    return res.status(400).json({ error: "Invalid token. Use CSR or CSR25" });
  }

  const tokenAddress = TOKEN_ADDRESSES[token];
  const cacheKey = token;

  // Check cache
  const cached = swapCache[cacheKey];
  if (cached && Date.now() - cached.timestamp < SWAP_CACHE_TTL_MS) {
    return res.json({
      token,
      token_address: tokenAddress,
      swaps: cached.data,
      cached: true,
      cache_age_sec: Math.round((Date.now() - cached.timestamp) / 1000),
    });
  }

  try {
    // Query Etherscan V2 API for token transfers (chainid=1 for Ethereum mainnet)
    const apiUrl = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=tokentx&contractaddress=${tokenAddress}&page=1&offset=100&sort=desc${
      ETHERSCAN_API_KEY ? `&apikey=${ETHERSCAN_API_KEY}` : ""
    }`;

    const response = await axios.get(apiUrl);

    if (response.data.status !== "1" || !response.data.result) {
      // Handle "No transactions found" as empty array, not error
      if (response.data.message === "No transactions found") {
        swapCache[cacheKey] = { data: [], timestamp: Date.now() };
        return res.json({
          token,
          token_address: tokenAddress,
          swaps: [],
          cached: false,
          total_found: 0,
        });
      }
      throw new Error(response.data.message || "Etherscan API error");
    }

    const transfers = response.data.result;

    // Process transfers into swap format
    const swaps = transfers.map((tx: any) => {
      const fromAddr = tx.from.toLowerCase();
      const toAddr = tx.to.toLowerCase();

      // Determine if this is a DEX swap (involves known DEX addresses)
      const isDexSwap =
        DEX_ADDRESSES.has(fromAddr) || DEX_ADDRESSES.has(toAddr);

      // Determine swap type:
      // - If token goes TO a DEX/pool = SELL (user selling token)
      // - If token comes FROM a DEX/pool = BUY (user buying token)
      let type: string;
      let wallet: string;

      if (DEX_ADDRESSES.has(toAddr)) {
        type = "Sell " + token;
        wallet = fromAddr;
      } else if (DEX_ADDRESSES.has(fromAddr)) {
        type = "Buy " + token;
        wallet = toAddr;
      } else {
        type = "Transfer";
        wallet = fromAddr;
      }

      // Calculate token amount (handle decimals)
      const decimals = parseInt(tx.tokenDecimal) || 18;
      const rawAmount = BigInt(tx.value);
      const tokenAmount = Number(rawAmount) / Math.pow(10, decimals);

      // Format time
      const timestamp = parseInt(tx.timeStamp);
      const date = new Date(timestamp * 1000);
      const now = Date.now();
      const ageMs = now - date.getTime();

      let timeAgo: string;
      if (ageMs < 3600000) {
        timeAgo = `${Math.floor(ageMs / 60000)}m`;
      } else if (ageMs < 86400000) {
        timeAgo = `${Math.floor(ageMs / 3600000)}h`;
      } else {
        timeAgo = `${Math.floor(ageMs / 86400000)}d`;
      }

      return {
        tx_hash: tx.hash,
        block_number: parseInt(tx.blockNumber),
        timestamp,
        time_ago: timeAgo,
        time_iso: date.toISOString(),
        type,
        is_dex_swap: isDexSwap,
        token_amount: tokenAmount,
        token_amount_formatted: tokenAmount.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        }),
        wallet: `${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
        wallet_full: wallet,
        from: tx.from,
        to: tx.to,
        etherscan_url: `https://etherscan.io/tx/${tx.hash}`,
      };
    });

    // Filter to only show DEX swaps (not regular transfers)
    const dexSwaps = swaps.filter((s: any) => s.is_dex_swap);

    // Update cache
    swapCache[cacheKey] = {
      data: dexSwaps,
      timestamp: Date.now(),
    };

    res.json({
      token,
      token_address: tokenAddress,
      swaps: dexSwaps,
      cached: false,
      total_transfers: transfers.length,
      dex_swaps: dexSwaps.length,
    });
  } catch (error: any) {
    console.error(`Error fetching swaps for ${token}:`, error.message);
    res.status(500).json({
      error: error.message,
      token,
      token_address: tokenAddress,
    });
  }
});

app.get('/api/decision', (req, res) => {
  res.json(dashboardData.decision);
});

app.get('/api/opportunities', (req, res) => {
  res.json({
    opportunities: dashboardData.opportunities,
    count: dashboardData.opportunities.length
  });
});

// Debug endpoint - shows configured URLs and last fetch timestamps (no secrets)
const serviceLastFetch: Record<string, string | null> = {
  lbank_gateway: null,
  latoken_gateway: null,
  uniswap_quote_csr: null,
  uniswap_quote_csr25: null,
  strategy_engine: null,
};

app.get('/api/debug', (req, res) => {
  res.json({
    ts: new Date().toISOString(),
    node_version: process.version,
    configured_urls: {
      lbank_gateway: LBANK_GATEWAY_URL,
      latoken_gateway: LATOKEN_GATEWAY_URL,
      uniswap_quote_csr: UNISWAP_QUOTE_CSR_URL,
      uniswap_quote_csr25: UNISWAP_QUOTE_URL,
      strategy_engine: STRATEGY_ENGINE_URL,
    },
    last_successful_fetch: {
      lbank_gateway: dashboardData.system_status?.lbank_gateway?.ts || null,
      uniswap_quote_csr: dashboardData.system_status?.uniswap_quote_csr?.ts || null,
      uniswap_quote_csr25: dashboardData.system_status?.uniswap_quote_csr25?.ts || null,
      strategy_engine: dashboardData.system_status?.strategy_engine?.ts || null,
    },
    service_status: {
      lbank_gateway: dashboardData.system_status?.lbank_gateway?.status || 'unknown',
      uniswap_quote_csr: dashboardData.system_status?.uniswap_quote_csr?.status || 'unknown',
      uniswap_quote_csr25: dashboardData.system_status?.uniswap_quote_csr25?.status || 'unknown',
      strategy_engine: dashboardData.system_status?.strategy_engine?.status || 'unknown',
      overall: dashboardData.system_status?.overall_status || 'unknown',
    },
    market_data_available: {
      csr_usdt_lbank: !!dashboardData.market_state?.csr_usdt?.lbank_ticker,
      csr_usdt_uniswap: !!dashboardData.market_state?.csr_usdt?.uniswap_quote,
      csr25_usdt_lbank: !!dashboardData.market_state?.csr25_usdt?.lbank_ticker,
      csr25_usdt_uniswap: !!dashboardData.market_state?.csr25_usdt?.uniswap_quote,
    },
  });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ 
  server,
  path: '/ws'
});

wss.on('connection', (ws: WebSocket) => {
  console.log('WebSocket client connected');
  wsClients.add(ws);
  
  // Send initial data
  ws.send(JSON.stringify(dashboardData));
  
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    wsClients.delete(ws);
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    wsClients.delete(ws);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Backend API server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});

// Start polling
setInterval(fetchServiceData, 1000);

// Initial fetch
fetchServiceData();
