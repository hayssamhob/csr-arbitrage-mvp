/**
 * CSR Arbitrage Monitoring Backend API
 * Node.js/TypeScript implementation aggregating microservices data
 */

// Load environment variables FIRST before any other imports
import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import cors from "cors";
import express from 'express';
import * as http from 'http';
import process from "process";
import { WebSocket, WebSocketServer } from "ws";
import { RedisConsumer } from "./redisConsumer";
import userRoutes from "./routes/user";

// Use require for ethers to avoid TS module resolution issues
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ethers = require("ethers");

// Configuration
const PORT = parseInt(process.env.PORT || "8001");
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const LBANK_GATEWAY_URL =
  process.env.LBANK_GATEWAY_URL || "http://localhost:3001";
const LATOKEN_GATEWAY_URL =
  process.env.LATOKEN_GATEWAY_URL || "http://localhost:3006";
const UNISWAP_V4_GATEWAY_URL =
  process.env.UNISWAP_QUOTE_URL || "http://localhost:3002";
const STRATEGY_ENGINE_URL =
  process.env.STRATEGY_ENGINE_URL || "http://localhost:3003";

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
    uniswap_v4_gateway: ServiceHealth;
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
    uniswap_v4_gateway: {
      service: "uniswap-v4-gateway",
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

// Persist price snapshot to Supabase (global, not user-specific)
async function persistPriceSnapshot(market: string, point: PricePoint) {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const response = await axios.post(
      `${supabaseUrl}/rest/v1/price_snapshots`,
      {
        market,
        cex_price: point.cex_price,
        dex_price: point.dex_price,
        spread_bps: point.spread_bps,
        timestamp: point.ts,
      },
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
      }
    );
  } catch (err) {
    // Silently fail - don't block main flow for persistence errors
  }
}

function addPricePoint(market: "csr_usdt" | "csr25_usdt", point: PricePoint) {
  priceHistory[market].push(point);
  if (priceHistory[market].length > MAX_HISTORY_POINTS) {
    priceHistory[market].shift();
  }
  // Also persist to Supabase (async, non-blocking)
  persistPriceSnapshot(market, point);
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

    // Fetch Uniswap V4 Gateway health
    let uniswapHealth: ServiceHealth | undefined;
    try {
      const resp = await httpClient.get(`${UNISWAP_V4_GATEWAY_URL}/health`);
      const data = resp.data;
      uniswapHealth = {
        service: "uniswap-v4-gateway",
        status: data.status || "ok",
        ts: data.ts || now,
        is_stale: false,
        connected: true,
        reconnect_count: 0,
        errors_last_5m: 0,
      };
    } catch {
      uniswapHealth = {
        service: "uniswap-v4-gateway",
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

    // Scraper logic removed in favor of V4 Gateway logic above
    // No redeclaration needed - using variables defined at start of fetchServiceData

    // Fetch market state from strategy engine (includes both markets)
    try {
      const resp = await httpClient.get(`${STRATEGY_ENGINE_URL}/state`);
      marketState = resp.data;
    } catch {
      // Use default structure if strategy engine is down
      marketState = {
        ts: now,
        csr_usdt: {
          lbank_ticker: null,
          uniswap_quote: null,
          decision: null,
        },
        csr25_usdt: {
          lbank_ticker: null,
          uniswap_quote: null,
          decision: null,
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
      uniswapHealth?.status || "error",
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
        uniswap_v4_gateway: uniswapHealth,
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

// User API routes (authenticated)
app.use('/api/me', userRoutes);

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
app.get("/api/price-history/:market", (req, res) => {
  const market = req.params.market;
  if (!["csr_usdt", "csr25_usdt"].includes(market)) {
    return res.status(400).json({ error: "Invalid market" });
  }

  // Add CORS headers for frontend access
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );

  // Return the last 20 price points (can be empty if no data yet)
  const marketKey = market as "csr_usdt" | "csr25_usdt";
  res.json({
    market,
    points: priceHistory[marketKey] || [],
    count: (priceHistory[marketKey] || []).length,
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

// Fallback DEX quotes from database when scraper fails
app.get("/api/dex-quotes/fallback", async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: "Database not configured" });
    }

    // Get latest price snapshots for both tokens
    const response = await fetch(
      `${supabaseUrl}/rest/v1/price_snapshots?select=market,cex_price,dex_price,spread_bps,timestamp&order=timestamp.desc&limit=2`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch price snapshots");
    }

    const snapshots = (await response.json()) as any[];

    // Transform to quote format
    const quotes = snapshots.map((snap: any) => ({
      market: snap.market,
      cex_price: parseFloat(snap.cex_price),
      dex_price: parseFloat(snap.dex_price),
      spread_bps: parseFloat(snap.spread_bps),
      timestamp: snap.timestamp,
      source: "database_fallback",
    }));

    res.json({ quotes, source: "database_fallback" });
  } catch (error: any) {
    console.error("Fallback quotes error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Price Deviation History - Last 20 entries from database
app.get("/api/price-deviation-history", async (req, res) => {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(503).json({ error: "Database not configured" });
    }

    // Get last 20 price snapshots
    const response = await fetch(
      `${supabaseUrl}/rest/v1/price_snapshots?select=market,cex_price,dex_price,spread_bps,timestamp&order=timestamp.desc&limit=20`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      }
    );

    if (!response.ok) {
      throw new Error("Failed to fetch price deviation history");
    }

    const snapshots = (await response.json()) as any[];

    // Transform to expected format
    const history = snapshots.map((snap: any) => ({
      market: snap.market,
      cex_price: parseFloat(snap.cex_price),
      dex_price: parseFloat(snap.dex_price),
      spread_bps: parseFloat(snap.spread_bps),
      timestamp: snap.timestamp,
      deviation_percent: Math.abs(parseFloat(snap.spread_bps) / 100),
    }));

    res.json({
      history,
      count: history.length,
      source: "database",
    });
  } catch (error: any) {
    console.error("Price deviation history error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Orchestrator API: /api/health - aggregated health
app.get("/api/health", (req, res) => {
  res.json(dashboardData.system_status);
});

// ============================================================================
// ADMIN: Kill Switch & Engine Status (Operational Cockpit)
// ============================================================================

// In-memory kill switch state (persisted to Redis if available)
let killSwitchActive = false;

// POST /api/admin/kill-switch - Toggle the emergency stop
app.post("/api/admin/kill-switch", async (req, res) => {
  const { active } = req.body;

  if (typeof active !== 'boolean') {
    return res.status(400).json({ success: false, error: 'Invalid body: active must be boolean' });
  }

  try {
    killSwitchActive = active;
    console.log(`[AUDIT] Kill Switch toggled to: ${active} at ${new Date().toISOString()}`);

    // Broadcast to all connected WebSocket clients
    wsClients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'KILL_SWITCH_UPDATE',
          active: killSwitchActive,
          ts: new Date().toISOString(),
        }));
      }
    });

    return res.json({ success: true, kill_switch_active: killSwitchActive });
  } catch (error: any) {
    console.error('Kill switch error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/engine-status - Current engine state
app.get("/api/admin/engine-status", (req, res) => {
  // In production, stealth mode would be checked against Flashbots config status
  const isStealthMode = process.env.ENABLE_FLASHBOTS === 'true';

  return res.json({
    kill_switch_active: killSwitchActive,
    stealth_mode: isStealthMode,
    ts: new Date().toISOString(),
  });
});

// Unified system status - TRUE health for all services
app.get("/api/system/status", async (req, res) => {
  const services = [
    { name: "lbank-gateway", url: "http://localhost:3001/ready" },
    { name: "latoken-gateway", url: "http://localhost:3006/ready" },
    { name: "strategy", url: "http://localhost:3003/ready" },
    { name: "uniswap-v4-gateway", url: "http://localhost:3002/health" },
  ];

  const results = await Promise.all(
    services.map(async (svc) => {
      try {
        const response = await axios.get(svc.url, { timeout: 5000 });
        const data = response.data;

        let status: "ok" | "degraded" | "down" = "ok";
        if (data.status === "unhealthy" || data.status === "down")
          status = "down";
        else if (data.status === "degraded") status = "degraded";

        // Check staleness
        if (data.last_message_ts) {
          const staleness =
            Date.now() - new Date(data.last_message_ts).getTime();
          if (staleness > 60000) status = "down";
          else if (staleness > 15000) status = "degraded";
        }
        if (data.connected === false) status = "down";

        return {
          name: svc.name,
          status,
          lastCheck: new Date().toISOString(),
          lastSuccess: status === "ok" ? new Date().toISOString() : null,
          lastError: status !== "ok" ? data.error || "Service issue" : null,
          details: {
            connected: data.connected,
            is_stale: data.is_stale,
            reconnect_count: data.reconnect_count,
            last_message_ts: data.last_message_ts,
          },
        };
      } catch (err: any) {
        return {
          name: svc.name,
          status: "down" as const,
          lastCheck: new Date().toISOString(),
          lastSuccess: null,
          lastError:
            err.code === "ECONNREFUSED" ? "Connection refused" : err.message,
          details: {},
        };
      }
    })
  );

  const allOk = results.every((r) => r.status === "ok");
  const anyDown = results.some((r) => r.status === "down");

  res.json({
    status: anyDown ? "down" : allOk ? "ok" : "degraded",
    ts: new Date().toISOString(),
    services: results,
    external: {
      supabase: {
        name: "supabase",
        status: "ok",
        lastCheck: new Date().toISOString(),
      },
    },
  });
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

// Scraper quotes proxy removed (no longer used)

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
  tick: number | null;
  lp_fee_bps: number | null;
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
const DEX_STALE_SEC = 600; // 10 minutes for DEX (scraper cycle can take 5-8 min on slow connections)

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
    tick: null,
    lp_fee_bps: null,
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

    // Track data quality issues but DON'T return early - always show available data
    const issues: string[] = [];

    if (!cexMid || !cexTs) {
      issues.push("cex_data_missing");
    } else {
      const cexAgeSec = (now - new Date(cexTs).getTime()) / 1000;
      if (cexAgeSec > CEX_STALE_SEC) {
        issues.push(`cex_stale: ${Math.round(cexAgeSec)}s`);
      }
    }

    // 2. Get DEX quotes (from local state updated via Redis)
    const dexQuote =
      market === "csr_usdt"
        ? dashboardData.market_state?.csr_usdt?.uniswap_quote
        : dashboardData.market_state?.csr25_usdt?.uniswap_quote;

    if (!dexQuote) {
      issues.push("dex_data_missing");
    }

    result.quotes_available = dexQuote ? 1 : 0;
    result.quotes_valid = dexQuote ? 1 : 0;

    // Get DEX price from Redis-updated state
    if (dexQuote) {
      result.ts_dex =
        typeof dexQuote.ts === "string"
          ? new Date(dexQuote.ts).getTime() / 1000
          : dexQuote.ts;
      result.dex_exec_price = dexQuote.effective_price_usdt;
      result.tick = dexQuote.tick || null;
      result.lp_fee_bps = dexQuote.lp_fee_bps || null;

      const dexAgeSec = now / 1000 - result.ts_dex!;
      if (dexAgeSec > DEX_STALE_SEC) {
        issues.push(`dex_stale: ${Math.round(dexAgeSec)}s`);
      }
    } else {
      issues.push("no_valid_dex_quote");
    }

    // If we have both prices, calculate deviation even if data is stale
    if (cexMid && result.dex_exec_price) {
      result.deviation_pct = ((result.dex_exec_price - cexMid) / cexMid) * 100;
    }

    // If there are critical issues, return with whatever data we have
    if (issues.length > 0 && (!cexMid || !dexQuote)) {
      result.reason = issues.join("; ");
      return res.json(result);
    }

    // Calculate trade size based on deviation percentage
    // Larger deviation = larger trade size needed to move price back
    // Base: $100 per 1% deviation, min $100, max $10,000
    const absDeviation = Math.abs(result.deviation_pct || 0);
    const calculatedSize = Math.min(
      Math.max(absDeviation * 100, 100), // $100 per 1% deviation, min $100
      10000 // Max $10,000
    );
    result.required_usdt = Math.round(calculatedSize);
    result.required_tokens = dexQuote
      ? Math.round((calculatedSize / dexQuote.effective_price_usdt) * 100) / 100
      : 0;
    result.expected_exec_price = result.dex_exec_price;
    result.price_impact_pct = Math.min(absDeviation * 0.1, 5); // Estimate: 0.1% impact per 1% deviation, max 5%
    result.network_cost_usd = dexQuote?.gas_estimate_usdt || 0.01;
    result.confidence =
      absDeviation > 5 ? "HIGH" : absDeviation > 2 ? "MEDIUM" : "LOW";
    result.reason = "computed_from_redis_tick";

    // Calculate alignment status based on deviation
    if (result.deviation_pct !== null) {
      const deviationBps = Math.abs(result.deviation_pct) * 100; // Convert % to bps
      const bandBpsThreshold = bandBps;

      if (deviationBps <= bandBpsThreshold) {
        // Within band - aligned, no action needed
        result.status = "ALIGNED";
        result.direction = "NONE";
      } else if (result.deviation_pct < 0) {
        // DEX price < CEX price → BUY on DEX (cheaper), SELL on CEX
        result.status = "BUY_ON_DEX";
        result.direction = "BUY";
      } else {
        // DEX price > CEX price → SELL on DEX (higher), BUY on CEX
        result.status = "SELL_ON_DEX";
        result.direction = "SELL";
      }
    }

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
      axios.get(`http://127.0.0.1:${PORT}/api/alignment/csr_usdt`),
      axios.get(`http://127.0.0.1:${PORT}/api/alignment/csr25_usdt`),
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
  res.status(501).json({ error: "Debug endpoint needs reimplementation for Redis V4 Model" });
});

app.get("/api/debug/timestamps", async (_req, res) => {
  res.status(501).json({ error: "Debug timestamps needs reimplementation for Redis V4 Model" });
});

// (Legacy ladder endpoint removed)

// ============================================================================
// Token Swap History - Using RPC Transfer events with pagination
// ============================================================================

// Token contract addresses
const TOKEN_ADDRESSES: Record<string, string> = {
  CSR: "0x75Ecb52e403C617679FBd3e77A50f9d10A842387",
  CSR25: "0x502E7230E142A332DFEd1095F7174834b2548982",
};

// Token decimals
const TOKEN_DECIMALS: Record<string, number> = {
  CSR: 18,
  CSR25: 18,
};

// Known DEX router/pool addresses to identify swaps
const DEX_ADDRESSES = new Set([
  "0x000000000004444c5dc75cb358380d2e3de08a90", // Uniswap v4 PoolManager
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad", // Uniswap Universal Router
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap SwapRouter02
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 SwapRouter
  "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b", // Uniswap Universal Router (old)
].map((a) => a.toLowerCase()));

// Cache for swaps (120s TTL - longer since blockchain data is stable)
interface SwapCache {
  data: any[];
  timestamp: number;
}
const swapCache: Record<string, SwapCache> = {};
const SWAP_CACHE_TTL_MS = 120000;

// RPC provider for Transfer event queries
const RPC_URL = process.env.RPC_URL || "https://eth.llamarpc.com";
const ethersProvider = new ethers.JsonRpcProvider(RPC_URL);

// ERC20 Transfer event topic
const TRANSFER_EVENT_TOPIC = ethers.id("Transfer(address,address,uint256)");

// Get token transfer history from blockchain
app.get("/api/swaps/:token", async (req, res) => {
  const token = req.params.token.toUpperCase();

  if (token !== "CSR" && token !== "CSR25") {
    return res.status(400).json({ error: "Invalid token. Use CSR or CSR25" });
  }

  const tokenAddress = TOKEN_ADDRESSES[token];
  const decimals = TOKEN_DECIMALS[token];
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
    const currentBlock = await ethersProvider.getBlockNumber();
    const allLogs: any[] = [];

    // Query in chunks of 500 blocks to stay within RPC limits
    // Scan last 10000 blocks (~33 hours) in 20 chunks
    const CHUNK_SIZE = 500;
    const TOTAL_BLOCKS = 10000;
    const chunks = Math.ceil(TOTAL_BLOCKS / CHUNK_SIZE);

    for (let i = 0; i < chunks && allLogs.length < 50; i++) {
      const toBlock = currentBlock - i * CHUNK_SIZE;
      const fromBlock = toBlock - CHUNK_SIZE + 1;

      if (fromBlock < 0) break;

      try {
        const logs = await ethersProvider.getLogs({
          address: tokenAddress,
          topics: [TRANSFER_EVENT_TOPIC],
          fromBlock,
          toBlock,
        });
        allLogs.push(...logs);
      } catch (e: any) {
        // If rate limited, stop querying more chunks
        if (e.message?.includes("rate") || e.message?.includes("limit")) {
          break;
        }
      }
    }

    // Deduplicate by tx hash and get unique block numbers
    const uniqueTxs = new Map<string, any>();
    const blockNumbers = new Set<number>();

    for (const log of allLogs) {
      if (!uniqueTxs.has(log.transactionHash)) {
        uniqueTxs.set(log.transactionHash, log);
        blockNumbers.add(log.blockNumber);
      }
    }

    // Fetch timestamps for unique blocks (limit to 20 to avoid rate limits)
    const blockTimestamps: Record<number, number> = {};
    const blocksToFetch = Array.from(blockNumbers).slice(0, 20);

    await Promise.all(
      blocksToFetch.map(async (blockNum) => {
        try {
          const block = await ethersProvider.getBlock(blockNum);
          if (block) {
            blockTimestamps[blockNum] = block.timestamp;
          }
        } catch {
          // Ignore individual block fetch errors
        }
      })
    );

    // Process logs into swap format
    const swaps = Array.from(uniqueTxs.values())
      .slice(0, 50) // Limit to 50 swaps
      .map((log: any) => {
        // Decode Transfer event: from, to, value
        const from = "0x" + log.topics[1].slice(26);
        const to = "0x" + log.topics[2].slice(26);
        const value = BigInt(log.data);
        const tokenAmount = Number(value) / Math.pow(10, decimals);

        const timestamp = blockTimestamps[log.blockNumber] || null;
        const date = timestamp ? new Date(timestamp * 1000) : new Date();
        const now = Date.now();
        const ageMs = timestamp ? now - timestamp * 1000 : 0;

        let timeAgo: string;
        if (!timestamp) {
          timeAgo = "—";
        } else if (ageMs < 3600000) {
          timeAgo = `${Math.floor(ageMs / 60000)}m`;
        } else if (ageMs < 86400000) {
          timeAgo = `${Math.floor(ageMs / 3600000)}h`;
        } else {
          timeAgo = `${Math.floor(ageMs / 86400000)}d`;
        }

        // Determine type based on DEX involvement
        const fromLower = from.toLowerCase();
        const toLower = to.toLowerCase();
        const isDexSwap =
          DEX_ADDRESSES.has(fromLower) || DEX_ADDRESSES.has(toLower);

        let type: string;
        let wallet: string;

        if (DEX_ADDRESSES.has(fromLower)) {
          type = `Buy ${token}`;
          wallet = to;
        } else if (DEX_ADDRESSES.has(toLower)) {
          type = `Sell ${token}`;
          wallet = from;
        } else {
          type = "Transfer";
          wallet = from;
        }

        return {
          tx_hash: log.transactionHash,
          block_number: log.blockNumber,
          timestamp,
          time_ago: timeAgo,
          time_iso: timestamp ? date.toISOString() : null,
          type,
          is_dex_swap: isDexSwap,
          token_amount: tokenAmount,
          token_amount_formatted: tokenAmount.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          }),
          wallet: `${wallet.slice(0, 6)}...${wallet.slice(-4)}`,
          wallet_full: wallet,
          from,
          to,
          etherscan_url: `https://etherscan.io/tx/${log.transactionHash}`,
        };
      })
      // Filter to only DEX swaps
      .filter((s: any) => s.is_dex_swap);

    // Update cache
    swapCache[cacheKey] = {
      data: swaps,
      timestamp: Date.now(),
    };

    res.json({
      token,
      token_address: tokenAddress,
      swaps,
      cached: false,
      total_found: swaps.length,
      blocks_scanned: TOTAL_BLOCKS,
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

// Trade Simulation Ladder Endpoint
app.get('/api/ladder/:marketId', (req, res) => {
  const marketId = req.params.marketId; // e.g., "CSR:0:0"
  // Parse symbol from marketId
  const symbol = marketId.split(':')[0].toLowerCase();
  const market = symbol.includes('csr25') ? 'csr25_usdt' : 'csr_usdt';

  // Get current market state
  const state = dashboardData.market_state?.[market];
  const midPrice = state?.lbank_ticker?.last || state?.latoken_ticker?.last || state?.uniswap_quote?.effective_price_usdt || 0;

  if (!midPrice) {
    return res.json({ ladder: [] });
  }

  // Generate synthetic ladder for visualization
  // In a real implementation, this would call the Strategy Engine or Uniswap Quoter
  const steps = [100, 500, 1000, 5000, 10000];
  const ladder = steps.map(amount => {
    // Simulate slippage (0.1% base + 0.05% per 1000 USDT)
    const slippage = 0.001 + (amount / 1000000) * 0.05;
    const priceImpact = slippage * 100;
    const effectivePrice = midPrice * (1 - slippage);
    const amountOut = amount / effectivePrice;

    return {
      amountIn: amount,
      amountOut,
      effectivePrice,
      priceImpact,
      route: 'v4_pool',
      gasEstimate: 0.5
    };
  });

  res.json({ ladder });
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
      uniswap_v4_gateway: UNISWAP_V4_GATEWAY_URL,
      strategy_engine: STRATEGY_ENGINE_URL,
    },
    last_successful_fetch: {
      lbank_gateway: dashboardData.system_status?.lbank_gateway?.ts || null,
      uniswap_v4_gateway: dashboardData.system_status?.uniswap_v4_gateway?.ts || null,
      strategy_engine: dashboardData.system_status?.strategy_engine?.ts || null,
    },
    service_status: {
      lbank_gateway: dashboardData.system_status?.lbank_gateway?.status || 'unknown',
      uniswap_v4_gateway: dashboardData.system_status?.uniswap_v4_gateway?.status || 'unknown',
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

// Start server - bind to 0.0.0.0 explicitly for IPv4 compatibility
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend API server running on port ${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}/ws`);
});

// Start polling (as fallback, reduced frequency when Redis is working)
setInterval(fetchServiceData, 2000);

// Initial fetch
fetchServiceData();

// ============================================================
// REDIS STREAMS INTEGRATION
// Real-time market data from gateways via Redis
// ============================================================

const redisConsumer = new RedisConsumer(REDIS_URL);

// Handle incoming market ticks from Redis
redisConsumer.on('tick', (tick) => {
  const now = new Date().toISOString();

  // Update market state based on tick type and source
  if (!dashboardData.market_state) {
    dashboardData.market_state = {
      ts: now,
      csr_usdt: {},
      csr25_usdt: {},
      is_stale: false,
    };
  }

  // Determine which market this tick belongs to
  const symbol = tick.symbol?.toLowerCase() || '';
  const market = symbol.includes('csr25') ? 'csr25_usdt' : 'csr_usdt';

  // Handle 'market.tick' (CEX) or 'cex_tick' (legacy)
  if (tick.type === 'market.tick' || tick.type === 'cex_tick') {
    // Map venue (gateway) to source (backend state)
    const source = tick.venue || tick.source;

    const tickerData = {
      bid: tick.bid,
      ask: tick.ask,
      last: tick.last,
      volume_24h: tick.volume_24h,
      ts: tick.ts,
      source: source,
    };

    if (source === 'lbank') {
      dashboardData.market_state[market].lbank_ticker = tickerData;
    } else if (source === 'latoken') {
      dashboardData.market_state[market].latoken_ticker = tickerData;
    }
  }
  // Handle 'market.quote' (DEX) or 'dex_quote' (legacy)
  else if (tick.type === 'market.quote' || tick.type === 'dex_quote' || tick.type === 'uniswap.quote') {
    // DEX quote from Uniswap gateway
    dashboardData.market_state[market].uniswap_quote = {
      effective_price_usdt: tick.effective_price_usdt || tick.price, // Handle varying fields
      amount_in: tick.amount_in || 1000,
      amount_out: tick.amount_out,
      gas_estimate_usdt: tick.gas_estimate_usdt || 0.5,
      route: tick.route || "v4_pool",
      ts: tick.ts,
      source: tick.source || "uniswap_v4",
      tick: tick.tick || null,
      lp_fee_bps: tick.lp_fee_bps || null,
    };
  }

  dashboardData.market_state.ts = now;
  dashboardData.market_state.is_stale = false;
  dashboardData.ts = now;

  // Broadcast to WebSocket clients immediately
  if (wsClients.size > 0) {
    const message = JSON.stringify(dashboardData);
    wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
});

redisConsumer.on('connected', () => {
  console.log('[Backend] Redis Streams connected - receiving real-time data');
});

redisConsumer.on('error', (error) => {
  console.error('[Backend] Redis consumer error:', error.message);
});

redisConsumer.on('disconnected', () => {
  console.warn('[Backend] Redis disconnected - falling back to HTTP polling');
});

// Start Redis consumer
redisConsumer.start().catch((err) => {
  console.error('[Backend] Failed to start Redis consumer:', err);
  console.log('[Backend] Continuing with HTTP polling only');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Backend] Shutting down...');
  await redisConsumer.stop();
  server.close();
  process.exit(0);
});
