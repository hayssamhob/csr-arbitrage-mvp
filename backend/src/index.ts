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
const UNISWAP_QUOTE_URL = process.env.UNISWAP_QUOTE_URL || 'http://localhost:3002';
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
}

interface DashboardData {
  ts: string;
  market_state?: {
    ts: string;
    lbank_ticker?: any;
    uniswap_quote_csr25?: any;
    uniswap_quote_csr?: any;
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

    // Build market state with quotes from both services
    let uniswapQuoteCSR25: any = null;
    let uniswapQuoteCSR: any = null;

    try {
      const resp = await httpClient.post(`${UNISWAP_QUOTE_URL}/quote`, {
        amount_usdt: 1000,
        direction: "buy",
      });
      uniswapQuoteCSR25 = resp.data;
    } catch {
      // Ignore errors
    }

    try {
      const resp = await httpClient.post(`${UNISWAP_QUOTE_CSR_URL}/quote`, {
        amount_usdt: 1000,
        direction: "buy",
      });
      uniswapQuoteCSR = resp.data;
    } catch {
      // Ignore errors
    }

    try {
      const resp = await httpClient.get(`${STRATEGY_ENGINE_URL}/state`);
      marketState = resp.data;
    } catch {
      // Ignore errors
    }

    // Update market state with both quotes
    if (marketState) {
      marketState.uniswap_quote_csr25 = uniswapQuoteCSR25;
      marketState.uniswap_quote_csr = uniswapQuoteCSR;
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
      opportunities: decision && decision.would_trade ? [decision] : [],
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

app.get('/api/health', (req, res) => {
  res.json(dashboardData.system_status);
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
