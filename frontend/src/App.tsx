/**
 * DEX Price Defense & Arbitrage Platform
 * 
 * Primary Purpose: Keep Uniswap DEX prices aligned with CEX reference prices
 * Secondary: Capture arbitrage when safe
 * 
 * v2.0 - Complete UI Redesign per Product Spec
 */

import { useEffect, useState, useMemo } from "react";
import { UniswapTradePanel } from "./components/UniswapTradePanel";
import { PriceAlignmentCard } from "./components/PriceAlignmentCard";
import { MarketContextCard } from "./components/MarketContextCard";
import { AdvancedMetricsCard } from "./components/AdvancedMetricsCard";
import { GlobalStatusBar } from "./components/GlobalStatusBar";
import { useWallet } from "./hooks/useWallet";
import type { DexQuote } from "./lib/alignmentEngine";

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

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryState>({
    csr_usdt: [],
    csr25_usdt: [],
  });
  const [scraperData, setScraperData] = useState<ScraperData | null>(null);
  const wallet = useWallet();
  const [showTradePanel, setShowTradePanel] = useState<{
    token: "CSR" | "CSR25";
    direction: "buy" | "sell";
  } | null>(null);
  const [executionMode, setExecutionMode] = useState<"OFF" | "MANUAL" | "AUTO">("OFF");
  const [killSwitchActive, setKillSwitchActive] = useState(false);

  // Convert scraper quotes to DexQuote format
  const csrDexQuotes: DexQuote[] = useMemo(() => {
    if (!scraperData?.quotes) return [];
    return scraperData.quotes
      .filter(q => q.market === "CSR_USDT" && q.valid)
      .map(q => ({
        amountInUSDT: q.amountInUSDT,
        tokensOut: q.amountOutToken,
        executionPrice: q.price_usdt_per_token,
        gasEstimateUsdt: q.gasEstimateUsdt || 2.5,
        slippagePercent: 0.5,
        valid: q.valid,
        source: "ui_scrape",
      }));
  }, [scraperData]);

  const csr25DexQuotes: DexQuote[] = useMemo(() => {
    if (!scraperData?.quotes) return [];
    return scraperData.quotes
      .filter(q => q.market === "CSR25_USDT" && q.valid)
      .map(q => ({
        amountInUSDT: q.amountInUSDT,
        tokensOut: q.amountOutToken,
        executionPrice: q.price_usdt_per_token,
        gasEstimateUsdt: q.gasEstimateUsdt || 2.5,
        slippagePercent: 0.5,
        valid: q.valid,
        source: "ui_scrape",
      }));
  }, [scraperData]);

  const services = useMemo(() => [
    {
      name: "LBank",
      status: (data?.system_status?.lbank_gateway?.status === "ok" ? "ok" : "error") as "ok" | "warning" | "error" | "offline",
      lastUpdate: data?.system_status?.lbank_gateway?.ts || "—",
    },
    {
      name: "LATOKEN",
      status: (data?.system_status?.latoken_gateway?.status === "ok" ? "ok" : "error") as "ok" | "warning" | "error" | "offline",
      lastUpdate: data?.system_status?.latoken_gateway?.ts || "—",
    },
    {
      name: "Uniswap",
      status: (scraperData?.meta?.errorsLast5m === 0 ? "ok" : "warning") as "ok" | "warning" | "error" | "offline",
      lastUpdate: scraperData?.meta?.lastSuccessTs ? new Date(scraperData.meta.lastSuccessTs).toISOString() : "—",
    },
    {
      name: "Strategy",
      status: (data?.system_status?.strategy_engine?.status === "ok" ? "ok" : "warning") as "ok" | "warning" | "error" | "offline",
      lastUpdate: data?.system_status?.strategy_engine?.ts || "—",
    },
  ], [data, scraperData]);

  const handleAlignmentExecute = (direction: string, _tokenAmount: number) => {
    const isBuy = direction === "BUY_ON_DEX";
    setShowTradePanel({
      token: "CSR25",
      direction: isBuy ? "buy" : "sell",
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
    return () => { ws?.close(); };
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 text-white">
      {/* Global Status Bar */}
      <GlobalStatusBar
        services={services}
        executionMode={executionMode}
        onModeChange={setExecutionMode}
        killSwitchActive={killSwitchActive}
        onKillSwitchToggle={() => setKillSwitchActive(!killSwitchActive)}
        lastDataUpdate={lastUpdate}
      />

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
              dexPrice={
                showTradePanel.token === "CSR"
                  ? data.market_state?.csr_usdt?.uniswap_quote?.effective_price_usdt || 0
                  : data.market_state?.csr25_usdt?.uniswap_quote?.effective_price_usdt || 0
              }
              cexPrice={
                showTradePanel.token === "CSR"
                  ? data.market_state?.csr_usdt?.latoken_ticker?.ask || 0
                  : data.market_state?.csr25_usdt?.lbank_ticker?.ask || 0
              }
              signer={wallet.signer}
              isConnected={wallet.isConnected}
              onConnect={wallet.connect}
            />
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <header className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img
                src="/depollute-logo-256.png"
                alt="Depollute Now!"
                className="h-14 w-14 rounded-lg shadow-lg shadow-emerald-500/20"
              />
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent">
                  DEX Price Defense
                </h1>
                <div className="text-slate-500 text-xs">
                  Depollute Now! • v2.0
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {error && (
                <div className="text-red-400 text-xs px-2 py-1 bg-red-500/10 rounded">
                  {error}
                </div>
              )}
              {wallet.isConnected ? (
                <div className="flex items-center gap-2 bg-slate-800/50 rounded-lg px-3 py-2 border border-slate-700">
                  <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                  <span className="font-mono text-sm text-emerald-400">
                    {wallet.address?.slice(0, 6)}...{wallet.address?.slice(-4)}
                  </span>
                  <button
                    onClick={wallet.disconnect}
                    className="text-xs text-slate-400 hover:text-red-400 ml-2"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <button
                  onClick={wallet.connect}
                  disabled={wallet.isConnecting}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white rounded-lg font-medium text-sm transition-colors"
                >
                  {wallet.isConnecting ? "Connecting..." : "🦊 Connect Wallet"}
                </button>
              )}
            </div>
          </div>
        </header>

        {/* PRIMARY: DEX Price Alignment Cards */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="text-2xl">⚡</span> DEX Price Alignment
            </h2>
            <span className="text-xs text-slate-500">
              Primary objective: Keep DEX aligned with CEX
            </span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <PriceAlignmentCard
              token="CSR"
              cexPrice={data?.market_state?.csr_usdt?.latoken_ticker?.bid || 0}
              dexQuotes={csrDexQuotes}
              executionMode={executionMode}
              onExecute={handleAlignmentExecute}
            />
            <PriceAlignmentCard
              token="CSR25"
              cexPrice={data?.market_state?.csr25_usdt?.lbank_ticker?.bid || 0}
              dexQuotes={csr25DexQuotes}
              executionMode={executionMode}
              onExecute={handleAlignmentExecute}
            />
          </div>
        </section>

        {/* SECONDARY: Market Context (Collapsed) */}
        <section className="mb-6">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Market Context</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <MarketContextCard
              token="CSR"
              cexData={data?.market_state?.csr_usdt?.latoken_ticker ? {
                bid: data.market_state.csr_usdt.latoken_ticker.bid,
                ask: data.market_state.csr_usdt.latoken_ticker.ask,
                last: data.market_state.csr_usdt.latoken_ticker.last,
                volume24h: data.market_state.csr_usdt.latoken_ticker.volume_24h || 0,
                source: "LATOKEN",
                timestamp: timeAgo(data.market_state.csr_usdt.latoken_ticker.ts),
              } : null}
              dexData={csrDexQuotes.length > 0 ? {
                executionPrice: csrDexQuotes[0].executionPrice,
                gasEstimateUsdt: csrDexQuotes[0].gasEstimateUsdt,
                slippagePercent: csrDexQuotes[0].slippagePercent,
                quoteSize: csrDexQuotes[0].amountInUSDT,
                route: "Uniswap V3",
                source: "UI Scrape",
                timestamp: "live",
              } : null}
            />
            <MarketContextCard
              token="CSR25"
              cexData={data?.market_state?.csr25_usdt?.lbank_ticker ? {
                bid: data.market_state.csr25_usdt.lbank_ticker.bid,
                ask: data.market_state.csr25_usdt.lbank_ticker.ask,
                last: data.market_state.csr25_usdt.lbank_ticker.last,
                volume24h: data.market_state.csr25_usdt.lbank_ticker.volume_24h,
                source: "LBANK",
                timestamp: timeAgo(data.market_state.csr25_usdt.lbank_ticker.ts),
              } : null}
              dexData={csr25DexQuotes.length > 0 ? {
                executionPrice: csr25DexQuotes[0].executionPrice,
                gasEstimateUsdt: csr25DexQuotes[0].gasEstimateUsdt,
                slippagePercent: csr25DexQuotes[0].slippagePercent,
                quoteSize: csr25DexQuotes[0].amountInUSDT,
                route: "Uniswap V3",
                source: "UI Scrape",
                timestamp: "live",
              } : null}
            />
          </div>
        </section>

        {/* ADVANCED: Arbitrage Metrics (Collapsed) */}
        <section className="mb-6">
          <h3 className="text-sm font-medium text-slate-400 mb-3">Advanced Analytics</h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AdvancedMetricsCard
              token="CSR"
              cexPrice={data?.market_state?.csr_usdt?.latoken_ticker?.bid || 0}
              dexPrice={csrDexQuotes[0]?.executionPrice || 0}
              spreadHistory={priceHistory.csr_usdt.map(p => ({
                timestamp: new Date(p.ts).getTime(),
                spreadBps: p.spread_bps,
              }))}
              transactions={[]}
            />
            <AdvancedMetricsCard
              token="CSR25"
              cexPrice={data?.market_state?.csr25_usdt?.lbank_ticker?.bid || 0}
              dexPrice={csr25DexQuotes[0]?.executionPrice || 0}
              spreadHistory={priceHistory.csr25_usdt.map(p => ({
                timestamp: new Date(p.ts).getTime(),
                spreadBps: p.spread_bps,
              }))}
              transactions={[]}
            />
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-slate-600 text-xs mt-8 pb-4 border-t border-slate-800 pt-4">
          <div className="flex items-center justify-center gap-2 mb-1">
            <img src="/depollute-logo-256.png" alt="Depollute" className="h-4 w-4 opacity-40" />
            <span>Depollute Now! DEX Price Defense Platform</span>
          </div>
          <p>Data refreshes automatically • {killSwitchActive ? "🛑 Kill Switch Active" : "🛡️ System Protected"}</p>
        </footer>
      </div>
    </div>
  );
}

export default App;
