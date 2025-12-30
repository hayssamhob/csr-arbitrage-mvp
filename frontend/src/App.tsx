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

    // Helper to check if status is healthy (backend returns "healthy" or "ok")
    const isHealthy = (status: string | undefined) =>
      status === "ok" || status === "healthy";

    // LBank (CEX for CSR25) - 30s freshness threshold
    const lbankTs = data?.system_status?.lbank_gateway?.ts;
    const lbankAge = getAge(lbankTs);
    const lbankStale = lbankAge > FRESHNESS.CEX_STALE_SEC;
    const lbankStatus = data?.system_status?.lbank_gateway?.status;
    const lbankReason = !lbankStatus
      ? "no data"
      : !isHealthy(lbankStatus)
      ? data?.system_status?.lbank_gateway?.subscription_errors?.[
          "csr25_usdt"
        ] || "reconnecting..."
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
      : !isHealthy(latokenStatus)
      ? "reconnecting..."
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
          : isHealthy(lbankStatus) && !lbankStale
          ? "ok"
          : lbankStale
          ? "warning"
          : "warning") as ServiceStatus["status"],
        lastUpdate: lbankTs || "—",
        ageSeconds: lbankAge < 999 ? lbankAge : undefined,
        isStale: lbankStale,
        reason: lbankReason,
      },
      {
        name: "LATOKEN",
        status: (!latokenStatus
          ? "offline"
          : isHealthy(latokenStatus) && !latokenStale
          ? "ok"
          : latokenStale
          ? "warning"
          : "warning") as ServiceStatus["status"],
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

    // Get valid quotes from scraper for this token
    const quotes = token === "CSR" ? csrDexQuotes : csr25DexQuotes;

    // Find the closest valid quote to the requested amount
    let dexPrice = alignment?.expected_exec_price || 0;

    if (dexPrice === 0 && quotes.length > 0) {
      // Find the quote closest to the requested amount
      const sortedQuotes = [...quotes].sort(
        (a, b) =>
          Math.abs(a.amountInUSDT - usdtAmount) -
          Math.abs(b.amountInUSDT - usdtAmount)
      );
      const closestQuote = sortedQuotes[0];
      if (closestQuote && closestQuote.executionPrice > 0) {
        dexPrice = closestQuote.executionPrice;
      }
    }

    // Fallback: use dex_exec_price from alignment if still 0
    if (dexPrice === 0 && alignment?.dex_exec_price) {
      dexPrice = alignment.dex_exec_price;
    }

    const cexPrice = alignment?.cex_mid || 0;

    setShowTradePanel({
      token,
      direction: isBuy ? "buy" : "sell",
      recommendedAmount: usdtAmount,
      dexPrice,
      cexPrice,
    });
  };

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
    const interval = setInterval(fetchAlignment, 3000);
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

  // Local mode state
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
    <div className="min-h-screen bg-[#020617] text-slate-200 selection:bg-emerald-500/30">
      {/* Background Decorative Elements */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-emerald-900/10 blur-[120px] rounded-full animate-pulse"></div>
        <div className="absolute top-[20%] -right-[10%] w-[30%] h-[30%] bg-blue-900/10 blur-[100px] rounded-full"></div>
        <div className="absolute -bottom-[10%] left-[20%] w-[35%] h-[35%] bg-cyan-900/10 blur-[110px] rounded-full"></div>
      </div>

      <div className="relative max-w-7xl mx-auto px-4 py-8 space-y-8">
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
              <h2 className="text-sm font-black uppercase tracking-[0.3em] text-emerald-500/80">
                Live Monitoring
              </h2>
            </div>
            <h1 className="text-4xl font-black text-white tracking-tight">
              Market <span className="text-slate-500">Alignment</span>
            </h1>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-slate-900/50 backdrop-blur-sm border border-slate-800/50 rounded-xl p-1 shadow-inner">
              {(["PAPER", "MANUAL", "AUTO"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => handleModeChange(m)}
                  disabled={m === "AUTO"}
                  className={`px-4 py-2 text-xs font-bold rounded-lg transition-all duration-300 ${
                    pageMode === m
                      ? m === "PAPER"
                        ? "bg-amber-500 text-white shadow-lg shadow-amber-900/20"
                        : m === "MANUAL"
                        ? "bg-blue-600 text-white shadow-lg shadow-blue-900/20"
                        : "bg-emerald-600 text-white shadow-lg shadow-emerald-900/20"
                      : "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50"
                  } ${m === "AUTO" ? "opacity-30 cursor-not-allowed" : ""}`}
                >
                  {m}
                </button>
              ))}
            </div>

            <button
              onClick={() => setKillSwitch(!killSwitch)}
              className={`px-5 py-2 text-xs font-black rounded-xl border transition-all duration-300 ${
                killSwitch
                  ? "bg-red-500/10 border-red-500/50 text-red-500 shadow-[0_0_15px_rgba(239,68,68,0.2)] animate-pulse"
                  : "bg-slate-900/50 border-slate-700 text-slate-400 hover:border-emerald-500/50 hover:text-emerald-500"
              }`}
            >
              {killSwitch ? "🛑 EMERGENCY STOP" : "🟢 SYSTEM ACTIVE"}
            </button>
          </div>
        </header>

        {/* Global Status Bar - service health indicators */}
        <div className="bg-slate-900/40 backdrop-blur-md rounded-2xl border border-slate-800/50 p-4 shadow-xl">
          <GlobalStatusBar services={services} lastDataUpdate={lastUpdate} />
        </div>

        {/* Dual Token Display - CSR25 and CSR side by side */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* CSR25 Column */}
          <div className="space-y-6">
            <div className="bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-800/50 p-1 shadow-2xl overflow-hidden">
              <AlignmentDisplay
                token="CSR25"
                alignment={alignmentData?.csr25_usdt ?? null}
                onExecute={handleAlignmentExecute}
                executionMode={alignmentExecutionMode}
              />
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-800/50 p-6 shadow-xl hover:border-slate-700/50 transition-colors">
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
                  data?.market_state?.csr25_usdt?.uniswap_quote
                    ? {
                        executionPrice:
                          data.market_state.csr25_usdt.uniswap_quote
                            .effective_price_usdt,
                        gasEstimateUsdt: 0.01,
                        quoteSize: 100,
                        source: "Uniswap",
                        timestamp: timeAgo(
                          data.market_state.csr25_usdt.uniswap_quote.ts
                        ),
                      }
                    : null
                }
              />
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-800/50 p-6 shadow-xl overflow-hidden hover:border-slate-700/50 transition-colors">
              <QuoteLadder token="CSR25" />
            </div>
          </div>

          {/* CSR Column */}
          <div className="space-y-6">
            <div className="bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-800/50 p-1 shadow-2xl overflow-hidden">
              <AlignmentDisplay
                token="CSR"
                alignment={alignmentData?.csr_usdt ?? null}
                onExecute={handleAlignmentExecute}
                executionMode={alignmentExecutionMode}
              />
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-800/50 p-6 shadow-xl hover:border-slate-700/50 transition-colors">
              <MarketContextCard
                token="CSR"
                cexData={
                  data?.market_state?.csr_usdt?.latoken_ticker
                    ? {
                        bid: data.market_state.csr_usdt.latoken_ticker.bid,
                        ask: data.market_state.csr_usdt.latoken_ticker.ask,
                        last: data.market_state.csr_usdt.latoken_ticker.last,
                        volume24h:
                          data.market_state.csr_usdt.latoken_ticker
                            .volume_24h || 0,
                        source: "LATOKEN",
                        timestamp: timeAgo(
                          data.market_state.csr_usdt.latoken_ticker.ts
                        ),
                      }
                    : null
                }
                dexData={
                  data?.market_state?.csr_usdt?.uniswap_quote
                    ? {
                        executionPrice:
                          data.market_state.csr_usdt.uniswap_quote
                            .effective_price_usdt,
                        gasEstimateUsdt: 0.01,
                        quoteSize: 100,
                        source: "Uniswap",
                        timestamp: timeAgo(
                          data.market_state.csr_usdt.uniswap_quote.ts
                        ),
                      }
                    : null
                }
              />
            </div>
            <div className="bg-slate-900/40 backdrop-blur-xl rounded-3xl border border-slate-800/50 p-6 shadow-xl overflow-hidden hover:border-slate-700/50 transition-colors">
              <QuoteLadder token="CSR" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-slate-600 text-xs py-12 border-t border-slate-900">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img
              src="/depollute-logo-256.png"
              alt="CSR"
              className="h-6 w-6 grayscale opacity-20"
            />
            <span className="font-black tracking-widest uppercase opacity-30">
              Security Protocol Protected
            </span>
          </div>
          <p>© 2025 Depollute Now • All systems operational</p>
        </footer>
      </div>

      {/* Modals */}
      {showTradePanel && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
            onClick={() => setShowTradePanel(null)}
          ></div>
          <div className="relative w-full max-w-lg animate-in zoom-in-95 duration-200">
            <UniswapTradePanel
              token={showTradePanel.token}
              dexPrice={showTradePanel.dexPrice}
              cexPrice={showTradePanel.cexPrice}
              direction={showTradePanel.direction}
              onClose={() => setShowTradePanel(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
