/**
 * DEX Price Defense & Arbitrage Platform
 * 
 * Primary Purpose: Keep Uniswap DEX prices aligned with CEX reference prices
 * Secondary: Capture arbitrage when safe
 * 
 * v2.0 - Complete UI Redesign per Product Spec
 */

import { useEffect, useMemo, useState } from "react";
import { AlignmentDisplay } from "./components/AlignmentDisplay";
import {
  GlobalStatusBar,
  type ServiceStatus,
} from "./components/GlobalStatusBar";
import { MarketContextCard } from "./components/MarketContextCard";
import { QuoteLadder } from "./components/QuoteLadder";
import { RecentSwaps } from "./components/RecentSwaps";
import { UniswapTradePanel } from "./components/UniswapTradePanel";
import type { DexQuote } from "./lib/alignmentEngine";

// Freshness thresholds per product spec v1.0
const FRESHNESS = {
  CEX_STALE_SEC: 30, // CEX data stale after 30s
  DEX_STALE_SEC: 60, // DEX data stale after 60s
};

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8001");

function getWsUrl(): string {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL.replace("http", "ws") + "/ws";
  }
  if (import.meta.env.PROD) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }
  return "ws://localhost:8001/ws";
}

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

interface LBankTicker {
  type: string;
  symbol: string;
  ts: string;
  bid: number;
  ask: number;
  last: number;
  volume_24h: number;
}

interface UniswapQuote {
  type: string;
  pair: string;
  chain_id: number;
  ts: string;
  amount_in: string;
  effective_price_usdt: number;
  is_stale: boolean;
}

interface LatokenTicker {
  type: string;
  symbol: string;
  ts: string;
  bid: number;
  ask: number;
  last: number;
  volume_24h?: number;
}

interface MarketData {
  lbank_ticker?: LBankTicker;
  latoken_ticker?: LatokenTicker;
  uniswap_quote?: UniswapQuote;
}

interface MarketState {
  ts: string;
  csr_usdt: MarketData;
  csr25_usdt: MarketData;
  is_stale: boolean;
}

interface SystemStatus {
  ts: string;
  lbank_gateway?: ServiceHealth;
  latoken_gateway?: ServiceHealth;
  uniswap_quote_csr25?: ServiceHealth;
  uniswap_quote_csr?: ServiceHealth;
  strategy_engine?: ServiceHealth;
  overall_status: string;
}

interface DashboardData {
  ts: string;
  market_state?: MarketState;
  system_status: SystemStatus;
}

function timeAgo(ts: string): string {
  const now = Date.now();
  const then = new Date(ts).getTime();
  const diffMs = now - then;
  if (diffMs < 1000) return "just now";
  if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  return `${Math.floor(diffMs / 3600000)}h ago`;
}

interface PricePoint {
  ts: string;
  cex_price: number;
  dex_price: number;
  spread_bps: number;
}

interface PriceHistoryState {
  csr_usdt: PricePoint[];
  csr25_usdt: PricePoint[];
}

interface ScraperQuote {
  market: string;
  amountInUSDT: number;
  amountOutToken: number;
  price_usdt_per_token: number;
  price_token_per_usdt: number;
  gasEstimateUsdt: number | null;
  valid: boolean;
  reason?: string;
  ts: number;
}

interface ScraperData {
  quotes: ScraperQuote[];
  meta: {
    lastSuccessTs: number | null;
    errorsLast5m: number;
  };
}

// Backend alignment result - AUTHORITATIVE source for required trade sizes
interface BackendAlignment {
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

interface AlignmentData {
  ts: string;
  csr_usdt: BackendAlignment;
  csr25_usdt: BackendAlignment;
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [, setPriceHistory] = useState<PriceHistoryState>({
    csr_usdt: [],
    csr25_usdt: [],
  });
  const [scraperData, setScraperData] = useState<ScraperData | null>(null);
  const [alignmentData, setAlignmentData] = useState<AlignmentData | null>(
    null
  );
  const [showTradePanel, setShowTradePanel] = useState<{
    token: "CSR" | "CSR25";
    direction: "buy" | "sell";
    recommendedAmount: number;
    dexPrice: number;
    cexPrice: number;
  } | null>(null);

  // Convert scraper quotes to DexQuote format
  const csrDexQuotes: DexQuote[] = useMemo(() => {
    if (!scraperData?.quotes) return [];
    return scraperData.quotes
      .filter((q) => q.market === "CSR_USDT" && q.valid)
      .map((q) => ({
        amountInUSDT: q.amountInUSDT,
        tokensOut: q.amountOutToken,
        executionPrice: q.price_usdt_per_token,
        gasEstimateUsdt: q.gasEstimateUsdt ?? null,
        slippagePercent: 0.5,
        valid: q.valid,
        source: "ui_scrape",
      }));
  }, [scraperData]);

  const csr25DexQuotes: DexQuote[] = useMemo(() => {
    if (!scraperData?.quotes) return [];
    return scraperData.quotes
      .filter((q) => q.market === "CSR25_USDT" && q.valid)
      .map((q) => ({
        amountInUSDT: q.amountInUSDT,
        tokensOut: q.amountOutToken,
        executionPrice: q.price_usdt_per_token,
        gasEstimateUsdt: q.gasEstimateUsdt ?? null,
        slippagePercent: 0.5,
        valid: q.valid,
        source: "ui_scrape",
      }));
  }, [scraperData]);

  // Compute service status with freshness, age, and explicit reasons
  const services: ServiceStatus[] = useMemo(() => {
    const now = Date.now();

    // Helper to compute age in seconds
    const getAge = (ts: string | number | null | undefined): number => {
      if (!ts) return 999;
      const then = typeof ts === "number" ? ts : new Date(ts).getTime();
      return Math.floor((now - then) / 1000);
    };

    // LBank (CEX for CSR25) - 30s freshness threshold
    const lbankTs = data?.system_status?.lbank_gateway?.ts;
    const lbankAge = getAge(lbankTs);
    const lbankStale = lbankAge > FRESHNESS.CEX_STALE_SEC;
    const lbankStatus = data?.system_status?.lbank_gateway?.status;
    const lbankReason = !lbankStatus
      ? "no data"
      : lbankStatus !== "ok"
      ? data?.system_status?.lbank_gateway?.subscription_errors?.[
          "csr25_usdt"
        ] || "connection error"
      : lbankStale
      ? `stale (${lbankAge}s > ${FRESHNESS.CEX_STALE_SEC}s)`
      : undefined;

    // LATOKEN (CEX for CSR) - 30s freshness threshold
    const latokenTs = data?.system_status?.latoken_gateway?.ts;
    const latokenAge = getAge(latokenTs);
    const latokenStale = latokenAge > FRESHNESS.CEX_STALE_SEC;
    const latokenStatus = data?.system_status?.latoken_gateway?.status;
    const latokenReason = !latokenStatus
      ? "no data"
      : latokenStatus !== "ok"
      ? "connection error"
      : latokenStale
      ? `stale (${latokenAge}s > ${FRESHNESS.CEX_STALE_SEC}s)`
      : undefined;

    // Uniswap scraper (DEX) - 60s freshness threshold
    const uniswapTs = scraperData?.meta?.lastSuccessTs;
    const uniswapAge = getAge(uniswapTs);
    const uniswapStale = uniswapAge > FRESHNESS.DEX_STALE_SEC;
    const csrQuotes =
      scraperData?.quotes?.filter((q) => q.market === "CSR_USDT" && q.valid)
        .length || 0;
    const csr25Quotes =
      scraperData?.quotes?.filter((q) => q.market === "CSR25_USDT" && q.valid)
        .length || 0;

    // Strategy engine
    const strategyTs = data?.system_status?.strategy_engine?.ts;
    const strategyAge = getAge(strategyTs);
    const strategyStatus = data?.system_status?.strategy_engine?.status;

    return [
      {
        name: "LBank",
        status: (!lbankStatus
          ? "offline"
          : lbankStatus === "ok" && !lbankStale
          ? "ok"
          : lbankStale
          ? "warning"
          : "error") as ServiceStatus["status"],
        lastUpdate: lbankTs || "—",
        ageSeconds: lbankAge < 999 ? lbankAge : undefined,
        isStale: lbankStale,
        reason: lbankReason,
      },
      {
        name: "LATOKEN",
        status: (!latokenStatus
          ? "offline"
          : latokenStatus === "ok" && !latokenStale
          ? "ok"
          : latokenStale
          ? "warning"
          : "error") as ServiceStatus["status"],
        lastUpdate: latokenTs || "—",
        ageSeconds: latokenAge < 999 ? latokenAge : undefined,
        isStale: latokenStale,
        reason: latokenReason,
      },
      {
        name: "DEX CSR",
        status: (csrQuotes > 0 && !uniswapStale
          ? "ok"
          : csrQuotes === 0
          ? "error"
          : "warning") as ServiceStatus["status"],
        lastUpdate: uniswapTs ? new Date(uniswapTs).toISOString() : "—",
        ageSeconds: uniswapAge < 999 ? uniswapAge : undefined,
        isStale: uniswapStale || csrQuotes === 0,
        reason:
          csrQuotes === 0
            ? "no CSR quotes (scraper issue)"
            : uniswapStale
            ? `stale`
            : undefined,
      },
      {
        name: "DEX CSR25",
        status: (csr25Quotes > 0 && !uniswapStale
          ? "ok"
          : csr25Quotes === 0
          ? "error"
          : "warning") as ServiceStatus["status"],
        lastUpdate: uniswapTs ? new Date(uniswapTs).toISOString() : "—",
        ageSeconds: uniswapAge < 999 ? uniswapAge : undefined,
        isStale: uniswapStale || csr25Quotes === 0,
        reason:
          csr25Quotes === 0
            ? "no CSR25 quotes"
            : uniswapStale
            ? `stale`
            : undefined,
      },
      {
        name: "Strategy",
        status: (strategyStatus === "ok"
          ? "ok"
          : "warning") as ServiceStatus["status"],
        lastUpdate: strategyTs || "—",
        ageSeconds: strategyAge < 999 ? strategyAge : undefined,
        isStale: false,
        reason: strategyStatus !== "ok" ? "not running" : undefined,
      },
    ];
  }, [data, scraperData]);

  const handleAlignmentExecute = (
    token: "CSR" | "CSR25",
    direction: string,
    usdtAmount: number
  ) => {
    const isBuy = direction === "BUY";
    // Get the alignment data for this token to get correct prices
    const alignment =
      token === "CSR" ? alignmentData?.csr_usdt : alignmentData?.csr25_usdt;

    // Use expected_exec_price as DEX price (from scraping), cex_mid as CEX price
    const dexPrice = alignment?.expected_exec_price || 0;
    const cexPrice = alignment?.cex_mid || 0;

    setShowTradePanel({
      token,
      direction: isBuy ? "buy" : "sell",
      recommendedAmount: usdtAmount,
      dexPrice,
      cexPrice,
    });
  };

  // Fetch price history
  useEffect(() => {
    async function fetchHistory() {
      try {
        const [csrResp, csr25Resp] = await Promise.all([
          fetch(`${API_URL}/api/history/csr_usdt`),
          fetch(`${API_URL}/api/history/csr25_usdt`),
        ]);
        if (csrResp.ok && csr25Resp.ok) {
          const csrData = await csrResp.json();
          const csr25Data = await csr25Resp.json();
          setPriceHistory({
            csr_usdt: csrData.points || [],
            csr25_usdt: csr25Data.points || [],
          });
        }
      } catch (e) {
        console.error("Failed to fetch price history:", e);
      }
    }
    fetchHistory();
    const interval = setInterval(fetchHistory, 10000);
    return () => clearInterval(interval);
  }, []);

  // Fetch scraper quotes
  useEffect(() => {
    async function fetchScraperQuotes() {
      try {
        const resp = await fetch(`${API_URL}/api/scraper/quotes`);
        if (resp.ok) {
          const scraperJson = await resp.json();
          setScraperData(scraperJson);
        }
      } catch (e) {
        console.error("Failed to fetch scraper quotes:", e);
      }
    }
    fetchScraperQuotes();
    const interval = setInterval(fetchScraperQuotes, 5000);
    return () => clearInterval(interval);
  }, []);

  // Fetch alignment data from backend - AUTHORITATIVE source for required trade sizes
  // Frontend does NOT compute required sizes - only displays backend calculations
  useEffect(() => {
    async function fetchAlignment() {
      try {
        const resp = await fetch(`${API_URL}/api/alignment`);
        if (resp.ok) {
          const alignmentJson = await resp.json();
          setAlignmentData(alignmentJson);
        }
      } catch (e) {
        console.error("Failed to fetch alignment:", e);
      }
    }
    fetchAlignment();
    const interval = setInterval(fetchAlignment, 3000); // More frequent for responsiveness
    return () => clearInterval(interval);
  }, []);

  // Fetch initial data
  useEffect(() => {
    async function fetchInitialData() {
      try {
        const resp = await fetch(`${API_URL}/api/dashboard`);
        if (resp.ok) {
          const initialData = await resp.json();
          setData(initialData);
          setLastUpdate(new Date());
        }
      } catch {
        console.error("Failed to fetch initial data");
      }
    }
    fetchInitialData();
  }, []);

  // WebSocket connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    function connect() {
      ws = new WebSocket(getWsUrl());
      ws.onopen = () => setError(null);
      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setData(parsed);
          setLastUpdate(new Date());
        } catch {
          console.error("Failed to parse WS message");
        }
      };
      ws.onerror = () => setError("WebSocket error");
      ws.onclose = () => {
        setError("Connection lost");
        setTimeout(connect, 3000);
      };
    }
    connect();
    return () => {
      ws?.close();
    };
  }, []);

  // Polling fallback
  useEffect(() => {
    if (error) {
      const interval = setInterval(async () => {
        try {
          const resp = await fetch(`${API_URL}/api/dashboard`);
          if (resp.ok) {
            const newData = await resp.json();
            setData(newData);
            setLastUpdate(new Date());
            setError(null);
          }
        } catch {
          console.error("Polling failed");
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [error]);

  // Local mode state for this page (PAPER=observe only, MANUAL=confirm trades, AUTO=coming soon)
  const [pageMode, setPageMode] = useState<"PAPER" | "MANUAL" | "AUTO">(
    "MANUAL"
  );
  const [killSwitch, setKillSwitch] = useState(false);

  const handleModeChange = (newMode: "PAPER" | "MANUAL" | "AUTO") => {
    if (newMode === "AUTO" && killSwitch) {
      alert("Cannot enable AUTO mode while kill switch is active");
      return;
    }
    setPageMode(newMode);
  };

  // Map page mode to alignment execution mode
  const alignmentExecutionMode: "OFF" | "MANUAL" | "AUTO" =
    pageMode === "PAPER" ? "OFF" : pageMode;

  return (
    <div className="text-white">
      {/* Global Status Bar - service health indicators only */}
      <GlobalStatusBar services={services} lastDataUpdate={lastUpdate} />

      {/* Page Header - matching ArbitragePage style */}
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">⚡ DEX Price Alignment</h1>
            <p className="text-slate-400 text-sm">
              Primary objective: Keep DEX aligned with CEX
            </p>
          </div>

          {/* Mode & Controls */}
          <div className="flex items-center gap-4">
            {/* Mode Selector */}
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
              {(["PAPER", "MANUAL", "AUTO"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  disabled={m === "AUTO"}
                  title={
                    m === "PAPER"
                      ? "Simulate trades without real execution"
                      : m === "MANUAL"
                      ? "Confirm each trade before execution"
                      : "Automatic execution (coming soon)"
                  }
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                    pageMode === m
                      ? m === "PAPER"
                        ? "bg-yellow-600 text-white"
                        : m === "MANUAL"
                        ? "bg-blue-600 text-white"
                        : "bg-green-600 text-white"
                      : "text-slate-400 hover:text-white hover:bg-slate-700"
                  } ${m === "AUTO" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {m}
                </button>
              ))}
            </div>

            {/* Kill Switch */}
            <button
              onClick={() => setKillSwitch(!killSwitch)}
              title={killSwitch ? "Resume trading" : "Stop all trading"}
              className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${
                killSwitch
                  ? "bg-red-600 text-white animate-pulse"
                  : "bg-emerald-600 text-white"
              }`}
            >
              {killSwitch ? "🛑 STOPPED" : "🟢 ACTIVE"}
            </button>
          </div>
        </div>
      </div>

      {/* Trade Panel Modal */}
      {showTradePanel && data && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="relative max-w-md w-full">
            <button
              onClick={() => setShowTradePanel(null)}
              className="absolute -top-2 -right-2 bg-gray-700 hover:bg-gray-600 rounded-full w-8 h-8 flex items-center justify-center text-white z-10"
            >
              ✕
            </button>
            <UniswapTradePanel
              token={showTradePanel.token}
              direction={showTradePanel.direction}
              dexPrice={showTradePanel.dexPrice}
              cexPrice={showTradePanel.cexPrice}
              recommendedAmount={showTradePanel.recommendedAmount}
            />
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* PRIMARY: DEX Price Alignment Cards */}
        <section className="mb-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <AlignmentDisplay
              token="CSR"
              alignment={alignmentData?.csr_usdt || null}
              executionMode={alignmentExecutionMode}
              onExecute={handleAlignmentExecute}
            />
            <AlignmentDisplay
              token="CSR25"
              alignment={alignmentData?.csr25_usdt || null}
              executionMode={alignmentExecutionMode}
              onExecute={handleAlignmentExecute}
            />
          </div>
        </section>

        {/* TRADE SIMULATIONS: Quote Ladder - Moved above Market Context */}
        <section className="mb-6">
          <h3 className="text-sm font-medium text-slate-400 mb-3">
            Trade Simulations (Uniswap UI Scrape)
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <QuoteLadder token="CSR" />
            <QuoteLadder token="CSR25" />
          </div>
        </section>

        {/* SECONDARY: Market Context (Collapsed) */}
        <section className="mb-6">
          <h3 className="text-sm font-medium text-slate-400 mb-3">
            Market Context
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MarketContextCard
              token="CSR"
              cexData={
                data?.market_state?.csr_usdt?.latoken_ticker
                  ? {
                      bid: data.market_state.csr_usdt.latoken_ticker.bid,
                      ask: data.market_state.csr_usdt.latoken_ticker.ask,
                      last: data.market_state.csr_usdt.latoken_ticker.last,
                      volume24h:
                        data.market_state.csr_usdt.latoken_ticker.volume_24h ||
                        0,
                      source: "LATOKEN",
                      timestamp: timeAgo(
                        data.market_state.csr_usdt.latoken_ticker.ts
                      ),
                    }
                  : null
              }
              dexData={
                csrDexQuotes.length > 0
                  ? {
                      executionPrice: csrDexQuotes[0].executionPrice,
                      gasEstimateUsdt: csrDexQuotes[0].gasEstimateUsdt || null,
                      quoteSize: csrDexQuotes[0].amountInUSDT,
                      source: "UI Scrape",
                      timestamp: "live",
                    }
                  : null
              }
            />
            <MarketContextCard
              token="CSR25"
              cexData={
                data?.market_state?.csr25_usdt?.lbank_ticker
                  ? {
                      bid: data.market_state.csr25_usdt.lbank_ticker.bid,
                      ask: data.market_state.csr25_usdt.lbank_ticker.ask,
                      last: data.market_state.csr25_usdt.lbank_ticker.last,
                      volume24h:
                        data.market_state.csr25_usdt.lbank_ticker.volume_24h,
                      source: "LBANK",
                      timestamp: timeAgo(
                        data.market_state.csr25_usdt.lbank_ticker.ts
                      ),
                    }
                  : null
              }
              dexData={
                csr25DexQuotes.length > 0
                  ? {
                      executionPrice: csr25DexQuotes[0].executionPrice,
                      gasEstimateUsdt:
                        csr25DexQuotes[0].gasEstimateUsdt || null,
                      quoteSize: csr25DexQuotes[0].amountInUSDT,
                      source: "UI Scrape",
                      timestamp: "live",
                    }
                  : null
              }
            />
          </div>
        </section>

        {/* Recent On-Chain Swaps */}
        <section className="mt-6">
          <h3 className="text-lg font-semibold text-slate-300 mb-4">
            🔗 Recent On-Chain Transactions
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RecentSwaps token="CSR" />
            <RecentSwaps token="CSR25" />
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-slate-600 text-xs mt-8 pb-4 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-center gap-2 mb-1">
            <img
              src="/depollute-logo-256.png"
              alt="Depollute"
              className="h-4 w-4 opacity-40"
            />
            <span>Depollute Now! DEX Price Defense Platform</span>
          </div>
          <p>Data refreshes automatically • ️ System Protected</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
