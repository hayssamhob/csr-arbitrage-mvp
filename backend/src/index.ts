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

    // Fetch market state from strategy engine (includes both markets)
    try {
      const resp = await httpClient.get(`${STRATEGY_ENGINE_URL}/state`);
      marketState = resp.data;
    } catch {
      // Use default structure if strategy engine is down
      marketState = {
        ts: now,
        csr_usdt: { lbank_ticker: null, uniswap_quote: null, decision: null },
        csr25_usdt: { lbank_ticker: null, uniswap_quote: null, decision: null },
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

    // Update dashboard data
    dashboardData = {
      ts: now,
      market_state: marketState,
      decision: decision,
      system_status: {
        ts: now,
        lbank_gateway: lbankHealth,
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
