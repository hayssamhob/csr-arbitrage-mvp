/**
 * CSR Arbitrage Monitoring Backend API
 * Node.js/TypeScript implementation aggregating microservices data
 */
import axios from 'axios';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import * as http from 'http';
import { WebSocket, WebSocketServer } from 'ws';

dotenv.config();

// Configuration
const PORT = parseInt(process.env.PORT || '8001');
const LBANK_GATEWAY_URL = process.env.LBANK_GATEWAY_URL || 'http://localhost:3001';
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
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'csr-arbitrage-api',
    ts: new Date().toISOString()
  });
});

app.get('/api/dashboard', (req, res) => {
  res.json(dashboardData);
});

// Price history API for charts
app.get('/api/history/:market', (req, res) => {
  const market = req.params.market as 'csr_usdt' | 'csr25_usdt';
  if (market !== 'csr_usdt' && market !== 'csr25_usdt') {
    return res.status(400).json({ error: 'Invalid market. Use csr_usdt or csr25_usdt' });
  }
  res.json({
    market,
    points: priceHistory[market],
    count: priceHistory[market].length,
  });
});

// Orchestrator API: /api/state - unified market state
app.get('/api/state', (req, res) => {
  const state = {
    ts: dashboardData.ts,
    markets: {
      csr_usdt: {
        lbank: dashboardData.market_state?.csr_usdt?.lbank_ticker || null,
        uniswap: dashboardData.market_state?.csr_usdt?.uniswap_quote || null,
        decision: dashboardData.market_state?.csr_usdt?.decision || null,
        freshness: {
          lbank_age_ms: dashboardData.market_state?.csr_usdt?.lbank_ticker?.ts 
            ? Date.now() - new Date(dashboardData.market_state.csr_usdt.lbank_ticker.ts).getTime() 
            : null,
          uniswap_age_ms: dashboardData.market_state?.csr_usdt?.uniswap_quote?.ts
            ? Date.now() - new Date(dashboardData.market_state.csr_usdt.uniswap_quote.ts).getTime()
            : null,
        },
      },
      csr25_usdt: {
        lbank: dashboardData.market_state?.csr25_usdt?.lbank_ticker || null,
        uniswap: dashboardData.market_state?.csr25_usdt?.uniswap_quote || null,
        decision: dashboardData.market_state?.csr25_usdt?.decision || null,
        freshness: {
          lbank_age_ms: dashboardData.market_state?.csr25_usdt?.lbank_ticker?.ts
            ? Date.now() - new Date(dashboardData.market_state.csr25_usdt.lbank_ticker.ts).getTime()
            : null,
          uniswap_age_ms: dashboardData.market_state?.csr25_usdt?.uniswap_quote?.ts
            ? Date.now() - new Date(dashboardData.market_state.csr25_usdt.uniswap_quote.ts).getTime()
            : null,
        },
      },
    },
    opportunities: dashboardData.opportunities,
  };
  res.json(state);
});

// Orchestrator API: /api/health - aggregated health
app.get('/api/health', (req, res) => {
  res.json(dashboardData.system_status);
});

// Orchestrator API: /api/config - sanitized config (no secrets)
app.get('/api/config', (req, res) => {
  res.json({
    execution_mode: process.env.EXECUTION_MODE || 'off',
    kill_switch: process.env.KILL_SWITCH === 'true',
    max_order_usdt: parseFloat(process.env.MAX_ORDER_USDT || '1000'),
    max_daily_volume_usdt: parseFloat(process.env.MAX_DAILY_VOLUME_USDT || '10000'),
    min_edge_bps: parseFloat(process.env.MIN_EDGE_BPS || '50'),
    max_slippage_bps: parseFloat(process.env.MAX_SLIPPAGE_BPS || '100'),
    max_staleness_seconds: parseFloat(process.env.MAX_STALENESS_SECONDS || '30'),
    max_concurrent_orders: parseInt(process.env.MAX_CONCURRENT_ORDERS || '1'),
    symbols: ['csr_usdt', 'csr25_usdt'],
  });
});

// Scraper quotes proxy endpoint
app.get('/api/scraper/quotes', async (req, res) => {
  try {
    const response = await axios.get(`${UNISWAP_SCRAPER_URL}/quotes`, { timeout: 5000 });
    res.json(response.data);
  } catch (error: any) {
    console.error('Failed to fetch scraper quotes:', error.message);
    res.status(502).json({ 
      error: 'Scraper unavailable', 
      details: error.message,
      quotes: [],
      meta: { lastSuccessTs: null, errorsLast5m: 0 }
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
    | "NOT_SUPPORTED_YET"
    | "UNSAFE";
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

// SAFE CAPS - never recommend above these until user changes
const MAX_USDT_CAPS: Record<string, number> = {
  csr_usdt: 100, // max $100 for CSR
  csr25_usdt: 250, // max $250 for CSR25
};

// Price impact caps - reject if impact exceeds this
const PRICE_IMPACT_CAPS: Record<string, number> = {
  csr_usdt: 1.0, // max 1% price impact for CSR
  csr25_usdt: 2.0, // max 2% price impact for CSR25
};

// Freshness thresholds
const CEX_STALE_SEC = 30;
const DEX_STALE_SEC = 60;

app.get('/api/alignment/:market', async (req, res) => {
  const market = req.params.market.toLowerCase();
  
  if (market !== 'csr_usdt' && market !== 'csr25_usdt') {
    return res.status(400).json({ error: 'Invalid market. Use csr_usdt or csr25_usdt' });
  }

  const bandBps = ALIGNMENT_BANDS[market];
  const maxUsdtCap = MAX_USDT_CAPS[market];
  const priceImpactCap = PRICE_IMPACT_CAPS[market];
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

    // 3. Sort quotes by size (small to large) - LADDER APPROACH
    validQuotes.sort((a: any, b: any) => a.amountInUSDT - b.amountInUSDT);

    // 4. Get smallest quote as reference DEX price (spot price)
    const smallestQuote = validQuotes[0];
    const spotPrice = smallestQuote.price_usdt_per_token;
    result.dex_exec_price = spotPrice;
    result.dex_quote_size_usdt = smallestQuote.amountInUSDT;

    // 5. Calculate current deviation from CEX
    const deviationPct = ((spotPrice - cexMid) / cexMid) * 100;
    result.deviation_pct = Math.round(deviationPct * 100) / 100;
    const bandPct = bandBps / 100;

    // 6. Check if already aligned
    if (Math.abs(deviationPct) <= bandPct) {
      result.status = "ALIGNED";
      result.direction = "NONE";
      result.reason = `within_band: ${result.deviation_pct}% vs ±${bandPct}%`;
      result.confidence = "HIGH";
      return res.json(result);
    }

    // 7. Determine direction
    if (spotPrice > cexMid) {
      // DEX expensive -> SELL needed (not implemented yet)
      result.direction = "SELL";
      result.status = "NOT_SUPPORTED_YET";
      result.reason = "sell_quoting_not_implemented";
      return res.json(result);
    }

    // DEX is cheap -> BUY on DEX to push price up
    result.direction = "BUY";

    // 8. LADDER-ONLY approach: find smallest safe quote that brings price into band
    // Target: execution price should be >= cexMid * (1 - bandPct/100) to be within band
    const targetPrice = cexMid * (1 - bandPct / 100);

    let selectedQuote: any = null;
    let rejectReason: string | null = null;

    for (const quote of validQuotes) {
      // Check safe cap first
      if (quote.amountInUSDT > maxUsdtCap) {
        if (!selectedQuote) {
          rejectReason = `exceeds_safe_cap: max $${maxUsdtCap}`;
        }
        continue;
      }

      // Check price impact
      const impact =
        ((quote.price_usdt_per_token - spotPrice) / spotPrice) * 100;
      if (impact > priceImpactCap) {
        if (!selectedQuote) {
          rejectReason = `price_impact_too_high: ${impact.toFixed(
            2
          )}% > ${priceImpactCap}%`;
        }
        continue;
      }

      // Check if this quote brings price into band
      if (quote.price_usdt_per_token >= targetPrice) {
        selectedQuote = quote;
        break; // Found the smallest safe quote that works
      }

      // This quote doesn't reach target but is safe - keep as fallback
      if (!selectedQuote || quote.amountInUSDT > selectedQuote.amountInUSDT) {
        selectedQuote = quote;
      }
    }

    // 9. Evaluate result
    if (!selectedQuote) {
      result.status = "UNSAFE";
      result.reason = rejectReason || "no_safe_quotes_available";
      result.confidence = "NONE";
      return res.json(result);
    }

    // Check if selected quote actually reaches the target
    const quoteDev =
      ((selectedQuote.price_usdt_per_token - cexMid) / cexMid) * 100;
    const reachesTarget = Math.abs(quoteDev) <= bandPct;

    if (!reachesTarget) {
      // Best safe quote doesn't reach band
      result.status = "UNSAFE";
      result.reason = `not_achievable_within_safe_limits: best safe quote $${
        selectedQuote.amountInUSDT
      } gives ${quoteDev.toFixed(2)}% deviation`;
      result.confidence = "LOW";

      // Still populate the data so user can see what's available
      result.required_usdt = selectedQuote.amountInUSDT;
      result.required_tokens = selectedQuote.amountOutToken;
      result.expected_exec_price = selectedQuote.price_usdt_per_token;
      const impact =
        ((selectedQuote.price_usdt_per_token - spotPrice) / spotPrice) * 100;
      result.price_impact_pct = Math.round(impact * 100) / 100;
      result.network_cost_usd = selectedQuote.gasEstimateUsdt || null;

      return res.json(result);
    }

    // SUCCESS: Found a safe quote that reaches the band
    result.status = "BUY_ON_DEX";
    result.required_usdt = selectedQuote.amountInUSDT;
    result.required_tokens = selectedQuote.amountOutToken;
    result.expected_exec_price = selectedQuote.price_usdt_per_token;

    const impact =
      ((selectedQuote.price_usdt_per_token - spotPrice) / spotPrice) * 100;
    result.price_impact_pct = Math.round(impact * 100) / 100;
    result.network_cost_usd = selectedQuote.gasEstimateUsdt || null;
    result.confidence = validQuotes.length >= 3 ? "HIGH" : "MEDIUM";
    result.reason = `ladder_quote: $${
      selectedQuote.amountInUSDT
    } → ${selectedQuote.amountOutToken.toFixed(
      2
    )} tokens @ $${selectedQuote.price_usdt_per_token.toFixed(6)}`;

    return res.json(result);
  } catch (error: any) {
    result.reason = `error: ${error.message}`;
    return res.json(result);
  }
});

// Alignment for all markets
app.get('/api/alignment', async (req, res) => {
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

app.get('/api/market', (req, res) => {
  res.json(dashboardData.market_state);
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
