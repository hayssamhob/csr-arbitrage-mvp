/**
 * ArbitragePage - CEX↔DEX Arbitrage Execution
 * 
 * Goal: Profit from price differences between CEX and DEX
 * Modes: PAPER, MANUAL, AUTO
 * 
 * Shows:
 * - Real opportunities from LATOKEN and LBank APIs
 * - Expected PnL after costs
 * - Advanced analytics
 * - Price impact calculations
 * - Trade execution interface
 */

import { useEffect, useState } from "react";
import { AdvancedMetricsCard } from "../components/AdvancedMetricsCard";
import { Footer } from "../components/Footer";

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8001");

// Helper to get exchange URL for a market
function getExchangeUrl(venue: string, market: string): string {
  const token = market.split('/')[0];
  const urls: Record<string, Record<string, string>> = {
    LATOKEN: { CSR: "https://latoken.com/exchange/CSR_USDT" },
    LBank: { CSR25: "https://www.lbank.com/trade/csr25_usdt/" },
  };
  return urls[venue]?.[token] || "#";
}

function getDexUrl(market: string): string {
  const token = market.split('/')[0];
  const urls: Record<string, string> = {
    CSR: "https://app.uniswap.org/swap?inputCurrency=0xdac17f958d2ee523a2206206994597c13d831ec7&outputCurrency=0x6bba316c48b49bd1eac44573c5c871ff02958469",
    CSR25: "https://app.uniswap.org/swap?inputCurrency=0xdac17f958d2ee523a2206206994597c13d831ec7&outputCurrency=0x0f5c78f152152dda52a2ea45b0a8c10733010748",
  };
  return urls[token] || "#";
}

// Tooltip component for ArbitragePage
function Tooltip({ children, text }: { children: React.ReactNode; text: string }) {
  return (
    <div className="group relative inline-block">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-slate-600 max-w-xs">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
      </div>
    </div>
  );
}

// Clickable price component
function ClickablePrice({ 
  price, 
  href, 
  className = "",
  tooltip,
}: { 
  price: number; 
  href?: string; 
  className?: string;
  tooltip?: string;
}) {
  const formatPrice = (p: number): string => {
    if (p < 0.0001) return p.toFixed(8);
    if (p < 0.01) return p.toFixed(6);
    if (p < 1) return p.toFixed(4);
    return p.toFixed(2);
  };

  const content = (
    <span className={`font-mono ${className} ${href ? "hover:text-emerald-400 cursor-pointer underline decoration-dotted underline-offset-2" : ""}`}>
      ${formatPrice(price)}
    </span>
  );
  
  const wrapped = tooltip ? <Tooltip text={tooltip}>{content}</Tooltip> : content;
  
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-block">
        {wrapped}
      </a>
    );
  }
  return wrapped;
}


interface Opportunity {
  market: string;
  cex_venue: string;
  cex_bid: number;
  cex_ask: number;
  cex_mid: number;
  cex_ts: string;
  dex_exec_price: number;
  dex_quote_size: number;
  dex_price_impact: number;
  dex_gas_usd: number;
  dex_ts: string;
  edge_bps: number;
  edge_usd: number;
  max_safe_size: number;
  direction: "BUY_DEX_SELL_CEX" | "BUY_CEX_SELL_DEX";
  is_actionable: boolean;
  reason: string;
}

interface DashboardData {
  market_state?: {
    csr_usdt?: {
      latoken_ticker?: {
        bid: number;
        ask: number;
        last: number;
        volume_24h: number;
        ts: string;
      };
      uniswap_quote?: {
        effective_price_usdt: number;
        ts: string;
      };
      decision?: {
        edge_after_costs_bps: number;
        direction: string;
        would_trade: boolean;
        reason: string;
      };
    };
    csr25_usdt?: {
      lbank_ticker?: {
        bid: number;
        ask: number;
        last: number;
        volume_24h: number;
        ts: string;
      };
      uniswap_quote?: {
        effective_price_usdt: number;
        ts: string;
      };
      decision?: {
        edge_after_costs_bps: number;
        direction: string;
        would_trade: boolean;
        reason: string;
      };
    };
  };
}

interface PriceHistoryPoint {
  ts: string;
  spread_bps: number;
}

interface ArbitrageState {
  mode: "PAPER" | "MANUAL" | "AUTO";
  kill_switch: boolean;
  opportunities: Opportunity[];
  last_update: string;
  daily_pnl: number;
  trades_today: number;
  dashboard: DashboardData | null;
  priceHistory: {
    csr_usdt: PriceHistoryPoint[];
    csr25_usdt: PriceHistoryPoint[];
  };
}

export function ArbitragePage() {
  const [state, setState] = useState<ArbitrageState>({
    mode: "PAPER",
    kill_switch: true,
    opportunities: [],
    last_update: "",
    daily_pnl: 0,
    trades_today: 0,
    dashboard: null,
    priceHistory: { csr_usdt: [], csr25_usdt: [] },
  });
  const [selectedOpp, setSelectedOpp] = useState<Opportunity | null>(null);

  // Fetch real data from dashboard API
  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${API_URL}/api/dashboard`);
        const dashboard: DashboardData = await response.json();

        const opportunities: Opportunity[] = [];
        const now = new Date().toISOString();

        // CSR/USDT from LATOKEN
        const csrLatoken = dashboard.market_state?.csr_usdt?.latoken_ticker;
        const csrDex = dashboard.market_state?.csr_usdt?.uniswap_quote;
        const csrDecision = dashboard.market_state?.csr_usdt?.decision;
        if (csrLatoken && csrDex) {
          const cexMid = (csrLatoken.bid + csrLatoken.ask) / 2;
          const dexPrice = csrDex.effective_price_usdt;
          const edgeBps =
            csrDecision?.edge_after_costs_bps ??
            Math.round(((dexPrice - cexMid) / cexMid) * 10000);
          const edgeUsd = (edgeBps / 10000) * 500;

          opportunities.push({
            market: "CSR/USDT",
            cex_venue: "LATOKEN",
            cex_bid: csrLatoken.bid,
            cex_ask: csrLatoken.ask,
            cex_mid: cexMid,
            cex_ts: csrLatoken.ts,
            dex_exec_price: dexPrice,
            dex_quote_size: 500,
            dex_price_impact: 0.5,
            dex_gas_usd: 0.01,
            dex_ts: csrDex.ts,
            edge_bps: edgeBps,
            edge_usd: edgeUsd,
            max_safe_size: 500,
            direction:
              csrDecision?.direction === "buy_dex_sell_cex"
                ? "BUY_DEX_SELL_CEX"
                : "BUY_CEX_SELL_DEX",
            is_actionable: csrDecision?.would_trade ?? Math.abs(edgeBps) > 50,
            reason:
              csrDecision?.reason ??
              (Math.abs(edgeBps) > 50
                ? "Edge exceeds threshold"
                : "Edge below threshold"),
          });
        }

        // CSR25/USDT from LBank
        const csr25Lbank = dashboard.market_state?.csr25_usdt?.lbank_ticker;
        const csr25Dex = dashboard.market_state?.csr25_usdt?.uniswap_quote;
        const csr25Decision = dashboard.market_state?.csr25_usdt?.decision;
        if (csr25Lbank && csr25Dex) {
          const cexMid = (csr25Lbank.bid + csr25Lbank.ask) / 2;
          const dexPrice = csr25Dex.effective_price_usdt;
          const edgeBps =
            csr25Decision?.edge_after_costs_bps ??
            Math.round(((dexPrice - cexMid) / cexMid) * 10000);
          const edgeUsd = (edgeBps / 10000) * 1000;

          opportunities.push({
            market: "CSR25/USDT",
            cex_venue: "LBank",
            cex_bid: csr25Lbank.bid,
            cex_ask: csr25Lbank.ask,
            cex_mid: cexMid,
            cex_ts: csr25Lbank.ts,
            dex_exec_price: dexPrice,
            dex_quote_size: 1000,
            dex_price_impact: 0.3,
            dex_gas_usd: 0.01,
            dex_ts: csr25Dex.ts,
            edge_bps: edgeBps,
            edge_usd: edgeUsd,
            max_safe_size: 1000,
            direction:
              csr25Decision?.direction === "buy_dex_sell_cex"
                ? "BUY_DEX_SELL_CEX"
                : "BUY_CEX_SELL_DEX",
            is_actionable: csr25Decision?.would_trade ?? Math.abs(edgeBps) > 50,
            reason:
              csr25Decision?.reason ??
              (Math.abs(edgeBps) > 50
                ? "Edge exceeds threshold"
                : "Edge below threshold"),
          });
        }

        // Update price history
        setState((prev) => {
          const newHistory = { ...prev.priceHistory };

          if (csrLatoken && csrDex) {
            const cexMid = (csrLatoken.bid + csrLatoken.ask) / 2;
            const spreadBps = Math.round(
              ((csrDex.effective_price_usdt - cexMid) / cexMid) * 10000
            );
            newHistory.csr_usdt = [
              ...prev.priceHistory.csr_usdt.slice(-19),
              { ts: now, spread_bps: spreadBps },
            ];
          }

          if (csr25Lbank && csr25Dex) {
            const cexMid = (csr25Lbank.bid + csr25Lbank.ask) / 2;
            const spreadBps = Math.round(
              ((csr25Dex.effective_price_usdt - cexMid) / cexMid) * 10000
            );
            newHistory.csr25_usdt = [
              ...prev.priceHistory.csr25_usdt.slice(-19),
              { ts: now, spread_bps: spreadBps },
            ];
          }

          return {
            ...prev,
            opportunities,
            last_update: now,
            dashboard,
            priceHistory: newHistory,
          };
        });
      } catch (err) {
        console.error("Failed to fetch arbitrage data:", err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleModeChange = (mode: "PAPER" | "MANUAL" | "AUTO") => {
    if (mode === "AUTO" && state.kill_switch) {
      alert("Cannot enable AUTO mode while kill switch is active");
      return;
    }
    setState((prev) => ({ ...prev, mode }));
  };

  const handleExecute = (opp: Opportunity) => {
    if (state.kill_switch) {
      alert("Kill switch is active - cannot execute");
      return;
    }
    if (state.mode === "PAPER") {
      console.log("Paper trade executed:", opp);
      alert(
        `PAPER TRADE: ${opp.direction} ${opp.market} - $${opp.max_safe_size}`
      );
    } else if (state.mode === "MANUAL") {
      setSelectedOpp(opp);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">📈 CEX↔DEX Arbitrage</h1>
            <p className="text-slate-400 text-sm">
              Profit from price differences between exchanges
            </p>
          </div>

          {/* Mode & Controls */}
          <div className="flex items-center gap-4">
            {/* Mode Selector */}
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-1">
              {(["PAPER", "MANUAL", "AUTO"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleModeChange(mode)}
                  disabled={mode === "AUTO"}
                  title={
                    mode === "PAPER"
                      ? "Simulate trades without real execution"
                      : mode === "MANUAL"
                      ? "Confirm each trade before execution"
                      : "Automatic execution (coming soon)"
                  }
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-all ${
                    state.mode === mode
                      ? mode === "PAPER"
                        ? "bg-yellow-600 text-white"
                        : mode === "MANUAL"
                        ? "bg-blue-600 text-white"
                        : "bg-green-600 text-white"
                      : "text-slate-400 hover:text-white hover:bg-slate-700"
                  } ${mode === "AUTO" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Kill Switch */}
            <button
              onClick={() =>
                setState((prev) => ({
                  ...prev,
                  kill_switch: !prev.kill_switch,
                }))
              }
              title={state.kill_switch ? "Resume trading" : "Stop all trading"}
              className={`px-3 py-1.5 text-xs font-bold rounded transition-all ${
                state.kill_switch
                  ? "bg-red-600 text-white animate-pulse"
                  : "bg-emerald-600 text-white"
              }`}
            >
              {state.kill_switch ? "🛑 STOPPED" : "🟢 ACTIVE"}
            </button>
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-6 text-sm">
          <div>
            <span className="text-slate-500">Mode:</span>
            <span
              className={`ml-2 font-medium ${
                state.mode === "PAPER"
                  ? "text-yellow-400"
                  : state.mode === "MANUAL"
                  ? "text-blue-400"
                  : "text-green-400"
              }`}
            >
              {state.mode}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Daily P&L:</span>
            <span
              className={`ml-2 font-mono ${
                state.daily_pnl >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              ${state.daily_pnl.toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-slate-500">Trades Today:</span>
            <span className="ml-2 font-mono text-white">
              {state.trades_today}
            </span>
          </div>
          <div className="ml-auto text-slate-500 text-xs">
            Last update:{" "}
            {state.last_update
              ? new Date(state.last_update).toLocaleTimeString()
              : "—"}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Opportunities Table */}
        <div className="bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700">
            <h2 className="font-semibold">Arbitrage Opportunities</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-800/50">
                <tr className="text-slate-400 text-left">
                  <th className="px-4 py-3 font-medium">Market</th>
                  <th className="px-4 py-3 font-medium">CEX</th>
                  <th className="px-4 py-3 font-medium text-right">
                    CEX Bid/Ask
                  </th>
                  <th className="px-4 py-3 font-medium text-right">
                    DEX Price
                  </th>
                  <th className="px-4 py-3 font-medium text-right">Edge</th>
                  <th className="px-4 py-3 font-medium text-right">Max Size</th>
                  <th className="px-4 py-3 font-medium">Direction</th>
                  <th className="px-4 py-3 font-medium text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {state.opportunities.map((opp, idx) => (
                  <tr
                    key={idx}
                    className={`${
                      opp.is_actionable ? "hover:bg-slate-800/30" : "opacity-50"
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">{opp.market}</td>
                    <td className="px-4 py-3 text-slate-400">
                      <Tooltip text={`View ${opp.market} on ${opp.cex_venue}`}>
                        <a
                          href={getExchangeUrl(opp.cex_venue, opp.market)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-emerald-400 transition-colors"
                        >
                          {opp.cex_venue} ↗
                        </a>
                      </Tooltip>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <ClickablePrice
                        price={opp.cex_bid}
                        href={getExchangeUrl(opp.cex_venue, opp.market)}
                        className="text-emerald-400"
                        tooltip={`Best bid price on ${opp.cex_venue} - click to view`}
                      />
                      <span className="text-slate-500 mx-1">/</span>
                      <ClickablePrice
                        price={opp.cex_ask}
                        href={getExchangeUrl(opp.cex_venue, opp.market)}
                        className="text-red-400"
                        tooltip={`Best ask price on ${opp.cex_venue} - click to view`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      <ClickablePrice
                        price={opp.dex_exec_price}
                        href={getDexUrl(opp.market)}
                        className="text-blue-400"
                        tooltip={`DEX execution price on Uniswap - includes ${opp.dex_price_impact.toFixed(
                          2
                        )}% price impact`}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div
                        className={`font-mono font-medium ${
                          opp.edge_bps >= 0
                            ? "text-emerald-400"
                            : "text-red-400"
                        }`}
                      >
                        {opp.edge_bps >= 0 ? "+" : ""}
                        {opp.edge_bps} bps
                      </div>
                      <div
                        className={`text-xs ${
                          opp.edge_usd >= 0
                            ? "text-emerald-400/70"
                            : "text-red-400/70"
                        }`}
                      >
                        ${opp.edge_usd.toFixed(2)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">
                      ${opp.max_safe_size}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          opp.direction === "BUY_DEX_SELL_CEX"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : "bg-blue-500/20 text-blue-400"
                        }`}
                      >
                        {opp.direction.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {opp.is_actionable ? (
                        <button
                          onClick={() => handleExecute(opp)}
                          disabled={state.kill_switch}
                          className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                            state.kill_switch
                              ? "bg-slate-700 text-slate-500 cursor-not-allowed"
                              : "bg-blue-600 text-white hover:bg-blue-500"
                          }`}
                        >
                          {state.mode === "PAPER" ? "Simulate" : "Execute"}
                        </button>
                      ) : (
                        <span className="text-slate-500 text-xs">
                          {opp.reason}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {state.opportunities.length === 0 && (
            <div className="px-4 py-8 text-center text-slate-500">
              No opportunities found. Waiting for data...
            </div>
          )}
        </div>

        {/* Advanced Analytics Section */}
        <div className="mt-6">
          <h3 className="text-sm font-medium text-slate-400 mb-3">
            Advanced Analytics
          </h3>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <AdvancedMetricsCard
              token="CSR"
              cexPrice={
                state.dashboard?.market_state?.csr_usdt?.latoken_ticker
                  ? (state.dashboard.market_state.csr_usdt.latoken_ticker.bid +
                      state.dashboard.market_state.csr_usdt.latoken_ticker
                        .ask) /
                    2
                  : 0
              }
              dexPrice={
                state.dashboard?.market_state?.csr_usdt?.uniswap_quote
                  ?.effective_price_usdt || 0
              }
              deviationHistory={state.priceHistory.csr_usdt.map((p) => ({
                timestamp: new Date(p.ts).getTime(),
                deviationBps: p.spread_bps,
              }))}
              transactions={[]}
            />
            <AdvancedMetricsCard
              token="CSR25"
              cexPrice={
                state.dashboard?.market_state?.csr25_usdt?.lbank_ticker
                  ? (state.dashboard.market_state.csr25_usdt.lbank_ticker.bid +
                      state.dashboard.market_state.csr25_usdt.lbank_ticker
                        .ask) /
                    2
                  : 0
              }
              dexPrice={
                state.dashboard?.market_state?.csr25_usdt?.uniswap_quote
                  ?.effective_price_usdt || 0
              }
              deviationHistory={state.priceHistory.csr25_usdt.map((p) => ({
                timestamp: new Date(p.ts).getTime(),
                deviationBps: p.spread_bps,
              }))}
              transactions={[]}
            />
          </div>
        </div>

        {/* Execution Confirmation Modal */}
        {selectedOpp && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-bold mb-4">
                Confirm Trade Execution
              </h3>

              <div className="space-y-3 mb-6">
                <div className="flex justify-between">
                  <span className="text-slate-400">Market:</span>
                  <span className="font-medium">{selectedOpp.market}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Direction:</span>
                  <span className="font-medium">
                    {selectedOpp.direction.replace(/_/g, " ")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Size:</span>
                  <span className="font-mono">
                    ${selectedOpp.max_safe_size}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Expected Edge:</span>
                  <span
                    className={`font-mono ${
                      selectedOpp.edge_usd >= 0
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    ${selectedOpp.edge_usd.toFixed(2)} ({selectedOpp.edge_bps}{" "}
                    bps)
                  </span>
                </div>
              </div>

              <div className="bg-yellow-900/30 border border-yellow-600/30 rounded-lg p-3 mb-6">
                <p className="text-yellow-400 text-sm">
                  ⚠️ This will execute real trades. Ensure you have sufficient
                  balances.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setSelectedOpp(null)}
                  className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    console.log("Executing trade:", selectedOpp);
                    alert("Trade execution not yet implemented");
                    setSelectedOpp(null);
                  }}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500"
                >
                  Confirm Execute
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
