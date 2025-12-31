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
import { useAuth } from "../contexts/AuthContext";

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8001");

// User risk limits from Supabase - NO HARDCODED DEFAULTS
interface UserRiskLimits {
  min_edge_bps: number;
  max_order_usdt: number;
  max_slippage_bps: number;
  kill_switch: boolean;
  loaded: boolean; // True only when fetched from DB
}

// Helper to get exchange URL for a market
function getExchangeUrl(venue: string, market: string): string {
  const token = market.split("/")[0];
  const urls: Record<string, Record<string, string>> = {
    LATOKEN: { CSR: "https://latoken.com/exchange/CSR_USDT" },
    LBank: { CSR25: "https://www.lbank.com/trade/csr25_usdt/" },
  };
  return urls[venue]?.[token] || "#";
}

function getDexUrl(market: string): string {
  const token = market.split("/")[0];
  const urls: Record<string, string> = {
    CSR: "https://app.uniswap.org/swap?inputCurrency=0xdac17f958d2ee523a2206206994597c13d831ec7&outputCurrency=0x6bba316c48b49bd1eac44573c5c871ff02958469",
    CSR25:
      "https://app.uniswap.org/swap?inputCurrency=0xdac17f958d2ee523a2206206994597c13d831ec7&outputCurrency=0x0f5c78f152152dda52a2ea45b0a8c10733010748",
  };
  return urls[token] || "#";
}

// Staleness check - abort if data is older than threshold (5 seconds for CEX, 10 for DEX)
const STALENESS_THRESHOLD_CEX_MS = 5000;
const STALENESS_THRESHOLD_DEX_MS = 10000;

function isDataStale(ts: string | undefined, thresholdMs: number): boolean {
  if (!ts) return true;
  const age = Date.now() - new Date(ts).getTime();
  return age > thresholdMs;
}

function getDataAge(ts: string | undefined): number {
  if (!ts) return 999;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
}

// Tooltip component for ArbitragePage
function Tooltip({
  children,
  text,
}: {
  children: React.ReactNode;
  text: string;
}) {
  return (
    <div className="group relative inline-block">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-[9999] border border-slate-600 max-w-xs">
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
    <span
      className={`font-mono ${className} ${
        href
          ? "hover:text-emerald-400 cursor-pointer underline decoration-dotted underline-offset-2"
          : ""
      }`}
    >
      ${formatPrice(price)}
    </span>
  );

  const wrapped = tooltip ? (
    <Tooltip text={tooltip}>{content}</Tooltip>
  ) : (
    content
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block"
      >
        {wrapped}
      </a>
    );
  }
  return wrapped;
}

// Trade Execution Modal with Amount Selection and Price Impact Preview
function TradeExecutionModal({
  opportunity,
  onClose,
  mode,
}: {
  opportunity: Opportunity;
  onClose: () => void;
  mode: "PAPER" | "MANUAL" | "AUTO";
}) {
  const [tradeSize, setTradeSize] = useState(100); // Default 100 USDT, no max limit
  const [isExecuting, setIsExecuting] = useState(false);

  // Calculate price impact based on trade size
  const basePriceImpact = opportunity.dex_price_impact;
  const estimatedPriceImpact =
    basePriceImpact * Math.sqrt(tradeSize / opportunity.dex_quote_size);

  // Calculate estimated edge after price impact
  const priceImpactCost = (estimatedPriceImpact / 100) * tradeSize;
  const estimatedEdgeUsd =
    (opportunity.edge_bps / 10000) * tradeSize - priceImpactCost;
  const estimatedEdgeBps = Math.round((estimatedEdgeUsd / tradeSize) * 10000);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      if (mode === "PAPER") {
        console.log("Paper trade executed:", {
          ...opportunity,
          size: tradeSize,
        });
        alert(
          `✅ PAPER TRADE: ${opportunity.direction.replace(
            /_/g,
            " "
          )} $${tradeSize} of ${
            opportunity.market
          }\nEstimated profit: $${estimatedEdgeUsd.toFixed(2)}`
        );
        onClose();
        return;
      }

      // Get auth token
      const authData = localStorage.getItem("auth");
      if (!authData) {
        alert("Please log in to execute trades");
        setIsExecuting(false);
        return;
      }
      const { accessToken } = JSON.parse(authData);

      // Parse market to get token symbol
      const token = opportunity.market.split("/")[0]; // CSR or CSR25
      const cexSymbol = `${token}/USDT`;

      // Determine trade direction
      // BUY_DEX_SELL_CEX: Buy on Uniswap, Sell on CEX
      // BUY_CEX_SELL_DEX: Buy on CEX, Sell on Uniswap

      // Token addresses
      const tokenAddress =
        token === "CSR"
          ? "0x6bba316c48b49bd1eac44573c5c871ff02958469"
          : "0x0f5c78f152152dda52a2ea45b0a8c10733010748";
      const usdtAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7";

      // Calculate token amount from USDT size
      const tokenAmount = tradeSize / opportunity.cex_mid;

      if (opportunity.direction === "BUY_CEX_SELL_DEX") {
        // SIMULTANEOUS EXECUTION: Buy on CEX, Sell on DEX
        // Step 1: Execute CEX BUY order
        const cexResponse = await fetch(`${API_URL}/api/me/trade/cex`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            exchange: opportunity.cex_venue.toLowerCase(),
            symbol: cexSymbol,
            side: "buy",
            amount: tokenAmount,
          }),
        });

        const cexResult = await cexResponse.json();
        if (!cexResult.success) {
          throw new Error(`CEX BUY failed: ${cexResult.error}`);
        }

        // Step 2: Open Uniswap to SELL the tokens (swap token -> USDT)
        const uniswapSellUrl = `https://app.uniswap.org/swap?inputCurrency=${tokenAddress}&outputCurrency=${usdtAddress}&exactAmount=${tokenAmount.toFixed(
          2
        )}`;
        window.open(uniswapSellUrl, "_blank");

        alert(
          `✅ ARBITRAGE INITIATED!\n\n` +
            `CEX BUY: ${
              cexResult.order.filled || tokenAmount.toFixed(2)
            } ${token} on ${opportunity.cex_venue}\n` +
            `Order ID: ${cexResult.order.id}\n\n` +
            `DEX SELL: Uniswap opened in new tab - complete the swap to finish arbitrage!`
        );
      } else {
        // BUY_DEX_SELL_CEX: Buy on DEX, Sell on CEX
        // Step 1: Open Uniswap to BUY tokens (swap USDT -> token)
        const uniswapBuyUrl = `https://app.uniswap.org/swap?inputCurrency=${usdtAddress}&outputCurrency=${tokenAddress}&exactAmount=${tradeSize}`;
        window.open(uniswapBuyUrl, "_blank");

        // Step 2: Execute CEX SELL order
        const cexResponse = await fetch(`${API_URL}/api/me/trade/cex`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            exchange: opportunity.cex_venue.toLowerCase(),
            symbol: cexSymbol,
            side: "sell",
            amount: tokenAmount,
          }),
        });

        const cexResult = await cexResponse.json();
        if (!cexResult.success) {
          throw new Error(`CEX SELL failed: ${cexResult.error}`);
        }

        alert(
          `✅ ARBITRAGE INITIATED!\n\n` +
            `DEX BUY: Uniswap opened - buy ${tokenAmount.toFixed(
              2
            )} ${token}\n\n` +
            `CEX SELL: Order placed for ${tokenAmount.toFixed(2)} ${token} on ${
              opportunity.cex_venue
            }\n` +
            `Order ID: ${cexResult.order.id}\n\n` +
            `Complete the Uniswap swap to finish arbitrage!`
        );
      }

      onClose();
    } catch (err: any) {
      console.error("Trade execution error:", err);
      alert(`Trade execution failed: ${err.message}`);
    }
    setIsExecuting(false);
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-slate-900 rounded-xl border border-slate-700 p-6 max-w-lg w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-bold">
            {mode === "PAPER" ? "📝 Paper Trade" : "⚡ Execute Trade"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>

        {/* Market Info */}
        <div className="bg-slate-800/50 rounded-lg p-4 mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-lg font-bold">{opportunity.market}</span>
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                opportunity.direction === "BUY_DEX_SELL_CEX"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : "bg-blue-500/20 text-blue-400"
              }`}
            >
              {opportunity.direction.replace(/_/g, " ")}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-400">
                CEX ({opportunity.cex_venue}):
              </span>
              <div className="font-mono">
                <span className="text-emerald-400">
                  ${opportunity.cex_bid.toFixed(6)}
                </span>
                <span className="text-slate-500"> / </span>
                <span className="text-red-400">
                  ${opportunity.cex_ask.toFixed(6)}
                </span>
              </div>
            </div>
            <div>
              <span className="text-slate-400">DEX (Uniswap):</span>
              <div className="font-mono text-blue-400">
                ${opportunity.dex_exec_price.toFixed(6)}
              </div>
            </div>
          </div>
        </div>

        {/* Trade Size Input */}
        <div className="mb-4">
          <label className="block text-sm text-slate-400 mb-2">
            Trade Size (USDT)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={tradeSize}
              onChange={(e) =>
                setTradeSize(Math.max(1, parseFloat(e.target.value) || 0))
              }
              className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-4 py-2 font-mono text-lg"
              min={1}
              step={10}
            />
            <div className="flex gap-1">
              <button
                onClick={() => setTradeSize(100)}
                className="px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs"
              >
                $100
              </button>
              <button
                onClick={() => setTradeSize(500)}
                className="px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs"
              >
                $500
              </button>
              <button
                onClick={() => setTradeSize(1000)}
                className="px-2 py-2 bg-slate-700 hover:bg-slate-600 rounded text-xs"
              >
                $1K
              </button>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-1">
            Recommended max: ${opportunity.max_safe_size} • You entered: $
            {tradeSize}
          </div>
        </div>

        {/* Price Impact & Cost Breakdown */}
        <div className="bg-slate-800/30 rounded-lg p-4 mb-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <Tooltip text="Impact on DEX price from your trade size">
              <span className="text-slate-400 cursor-help border-b border-dotted border-slate-500">
                Est. Price Impact:
              </span>
            </Tooltip>
            <span
              className={`font-mono ${
                estimatedPriceImpact > 1 ? "text-amber-400" : "text-slate-300"
              }`}
            >
              {estimatedPriceImpact.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between">
            <Tooltip text="Cost of price impact on your trade">
              <span className="text-slate-400 cursor-help border-b border-dotted border-slate-500">
                Impact Cost:
              </span>
            </Tooltip>
            <span className="font-mono text-red-400">
              -${priceImpactCost.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between border-t border-slate-700 pt-2 mt-2">
            <Tooltip text="Expected profit after all costs">
              <span className="text-slate-300 font-medium cursor-help border-b border-dotted border-slate-500">
                Estimated Profit:
              </span>
            </Tooltip>
            <span
              className={`font-mono font-bold ${
                estimatedEdgeUsd >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              ${estimatedEdgeUsd.toFixed(2)} ({estimatedEdgeBps > 0 ? "+" : ""}
              {estimatedEdgeBps} bps)
            </span>
          </div>
        </div>

        {/* Warning */}
        {estimatedPriceImpact > 2 && (
          <div className="bg-amber-900/30 border border-amber-600/30 rounded-lg p-3 mb-4">
            <p className="text-amber-400 text-sm">
              ⚠️ High price impact ({estimatedPriceImpact.toFixed(1)}%).
              Consider reducing trade size.
            </p>
          </div>
        )}

        {mode !== "PAPER" && (
          <div className="bg-yellow-900/30 border border-yellow-600/30 rounded-lg p-3 mb-4">
            <p className="text-yellow-400 text-sm">
              ⚠️ This will execute real trades. Ensure you have sufficient
              balances on both venues.
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleExecute}
            disabled={isExecuting || estimatedEdgeUsd < 0}
            className={`flex-1 px-4 py-3 rounded-lg font-medium transition-all ${
              estimatedEdgeUsd < 0
                ? "bg-slate-600 text-slate-400 cursor-not-allowed"
                : mode === "PAPER"
                ? "bg-yellow-600 text-white hover:bg-yellow-500"
                : "bg-emerald-600 text-white hover:bg-emerald-500"
            }`}
          >
            {isExecuting
              ? "Executing..."
              : mode === "PAPER"
              ? "Simulate Trade"
              : "Execute Trade"}
          </button>
        </div>
      </div>
    </div>
  );
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

interface UserBalance {
  venue: string;
  asset: string;
  available: number;
  total: number;
  usd_value: number;
}

interface UserInventory {
  balances: UserBalance[];
  total_usd: number;
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
  const [userInventory, setUserInventory] = useState<UserInventory | null>(
    null
  );

  // User risk limits - MUST be loaded before any decisions are made
  const [userLimits, setUserLimits] = useState<UserRiskLimits>({
    min_edge_bps: 0,
    max_order_usdt: 0,
    max_slippage_bps: 0,
    kill_switch: true,
    loaded: false, // NOT LOADED = block all actions
  });
  const [_limitsError, setLimitsError] = useState<string | null>(null);
  const { getAccessToken } = useAuth();

  // Helper to get available balance for a venue/asset
  const getAvailableBalance = (venue: string, asset: string): number => {
    if (!userInventory) return 0;
    const balance = userInventory.balances.find(
      (b) => b.venue === venue && b.asset === asset
    );
    return balance?.available || 0;
  };

  // Calculate max trade size based on actual balances
  const calculateMaxTradeSize = (opp: Opportunity): number => {
    if (!userInventory) return opp.max_safe_size;

    // For BUY_DEX_SELL_CEX: need USDT on DEX (wallet) to buy, token on CEX to sell
    // For BUY_CEX_SELL_DEX: need USDT on CEX to buy, token on wallet to sell
    const token = opp.market.split("/")[0]; // CSR or CSR25

    if (opp.direction === "BUY_DEX_SELL_CEX") {
      // Need USDT in wallet to buy on DEX
      const walletUsdt = getAvailableBalance("Wallet", "USDT");
      // Need token on CEX to sell
      const cexToken = getAvailableBalance(opp.cex_venue, token);
      const cexTokenValue = cexToken * opp.cex_bid;
      return Math.min(walletUsdt, cexTokenValue, opp.max_safe_size);
    } else {
      // Need USDT on CEX to buy
      const cexUsdt = getAvailableBalance(opp.cex_venue, "USDT");
      // Need token in wallet to sell on DEX
      const walletToken = getAvailableBalance("Wallet", token);
      const walletTokenValue = walletToken * opp.dex_exec_price;
      return Math.min(cexUsdt, walletTokenValue, opp.max_safe_size);
    }
  };

  // Fetch user risk limits FIRST - REQUIRED before any decisions
  useEffect(() => {
    const fetchLimits = async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          setLimitsError("Not authenticated - using blocked mode");
          return;
        }
        const res = await fetch(`${API_URL}/api/me/risk-limits`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setUserLimits({
            min_edge_bps: data.min_edge_bps,
            max_order_usdt: data.max_order_usdt,
            max_slippage_bps: data.max_slippage_bps,
            kill_switch: data.kill_switch,
            loaded: true,
          });
          setLimitsError(null);
        } else {
          setLimitsError("settings_not_loaded: Failed to fetch risk limits");
        }
      } catch (err) {
        setLimitsError("settings_not_loaded: Network error");
      }
    };
    fetchLimits();
  }, [getAccessToken]);

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

          // Calculate max safe size based on user's available balances
          const userMaxSize = userInventory
            ? calculateMaxTradeSize({
                market: "CSR/USDT",
                cex_venue: "LATOKEN",
                cex_bid: csrLatoken.bid,
                cex_ask: csrLatoken.ask,
                cex_mid: cexMid,
                cex_ts: csrLatoken.ts,
                dex_exec_price: dexPrice,
                dex_quote_size: 1000,
                dex_price_impact: 0.5,
                dex_gas_usd: 0.01,
                dex_ts: csrDex.ts,
                edge_bps: edgeBps,
                edge_usd: edgeUsd,
                max_safe_size: 10000, // High default, will be limited by balance
                direction:
                  csrDecision?.direction === "buy_dex_sell_cex"
                    ? "BUY_DEX_SELL_CEX"
                    : "BUY_CEX_SELL_DEX",
                is_actionable: true,
                reason: "",
              })
            : 1000; // Default if no inventory loaded

          const maxSafeSize = Math.max(10, Math.min(userMaxSize, 10000));
          const calculatedEdgeUsd = (edgeBps / 10000) * maxSafeSize;

          opportunities.push({
            market: "CSR/USDT",
            cex_venue: "LATOKEN",
            cex_bid: csrLatoken.bid,
            cex_ask: csrLatoken.ask,
            cex_mid: cexMid,
            cex_ts: csrLatoken.ts,
            dex_exec_price: dexPrice,
            dex_quote_size: maxSafeSize,
            dex_price_impact: 0.5,
            dex_gas_usd: 0.01,
            dex_ts: csrDex.ts,
            edge_bps: edgeBps,
            edge_usd: calculatedEdgeUsd,
            max_safe_size: maxSafeSize,
            direction:
              csrDecision?.direction === "buy_dex_sell_cex"
                ? "BUY_DEX_SELL_CEX"
                : "BUY_CEX_SELL_DEX",
            is_actionable: (() => {
              // Staleness check - BLOCK if data is stale
              const cexStale = isDataStale(
                csrLatoken.ts,
                STALENESS_THRESHOLD_CEX_MS
              );
              const dexStale = isDataStale(
                csrDex.ts,
                STALENESS_THRESHOLD_DEX_MS
              );
              if (cexStale || dexStale) return false;
              if (!userLimits.loaded) return false;
              if (userLimits.kill_switch) return false;
              return (
                csrDecision?.would_trade ??
                Math.abs(edgeBps) >= userLimits.min_edge_bps
              );
            })(),
            reason: (() => {
              const cexStale = isDataStale(
                csrLatoken.ts,
                STALENESS_THRESHOLD_CEX_MS
              );
              const dexStale = isDataStale(
                csrDex.ts,
                STALENESS_THRESHOLD_DEX_MS
              );
              if (cexStale)
                return `stale_cex_data (${getDataAge(csrLatoken.ts)}s old)`;
              if (dexStale)
                return `stale_dex_data (${getDataAge(csrDex.ts)}s old)`;
              if (!userLimits.loaded) return "settings_not_loaded";
              if (userLimits.kill_switch) return "kill_switch_active";
              return (
                csrDecision?.reason ??
                (Math.abs(edgeBps) >= userLimits.min_edge_bps
                  ? `Edge ${edgeBps}bps exceeds threshold ${userLimits.min_edge_bps}bps`
                  : `Edge ${edgeBps}bps below threshold ${userLimits.min_edge_bps}bps`)
              );
            })(),
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

          // Calculate max safe size based on user's available balances
          const csr25UserMaxSize = userInventory
            ? calculateMaxTradeSize({
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
                edge_usd: 0,
                max_safe_size: 10000,
                direction:
                  csr25Decision?.direction === "buy_dex_sell_cex"
                    ? "BUY_DEX_SELL_CEX"
                    : "BUY_CEX_SELL_DEX",
                is_actionable: true,
                reason: "",
              })
            : 1000;

          const csr25MaxSafeSize = Math.max(
            10,
            Math.min(csr25UserMaxSize, 10000)
          );
          const csr25EdgeUsd = (edgeBps / 10000) * csr25MaxSafeSize;

          opportunities.push({
            market: "CSR25/USDT",
            cex_venue: "LBank",
            cex_bid: csr25Lbank.bid,
            cex_ask: csr25Lbank.ask,
            cex_mid: cexMid,
            cex_ts: csr25Lbank.ts,
            dex_exec_price: dexPrice,
            dex_quote_size: csr25MaxSafeSize,
            dex_price_impact: 0.3,
            dex_gas_usd: 0.01,
            dex_ts: csr25Dex.ts,
            edge_bps: edgeBps,
            edge_usd: csr25EdgeUsd,
            max_safe_size: csr25MaxSafeSize,
            direction:
              csr25Decision?.direction === "buy_dex_sell_cex"
                ? "BUY_DEX_SELL_CEX"
                : "BUY_CEX_SELL_DEX",
            is_actionable: (() => {
              // Staleness check - BLOCK if data is stale
              const cexStale = isDataStale(
                csr25Lbank.ts,
                STALENESS_THRESHOLD_CEX_MS
              );
              const dexStale = isDataStale(
                csr25Dex.ts,
                STALENESS_THRESHOLD_DEX_MS
              );
              if (cexStale || dexStale) return false;
              if (!userLimits.loaded) return false;
              if (userLimits.kill_switch) return false;
              return (
                csr25Decision?.would_trade ??
                Math.abs(edgeBps) >= userLimits.min_edge_bps
              );
            })(),
            reason: (() => {
              const cexStale = isDataStale(
                csr25Lbank.ts,
                STALENESS_THRESHOLD_CEX_MS
              );
              const dexStale = isDataStale(
                csr25Dex.ts,
                STALENESS_THRESHOLD_DEX_MS
              );
              if (cexStale)
                return `stale_cex_data (${getDataAge(csr25Lbank.ts)}s old)`;
              if (dexStale)
                return `stale_dex_data (${getDataAge(csr25Dex.ts)}s old)`;
              if (!userLimits.loaded) return "settings_not_loaded";
              if (userLimits.kill_switch) return "kill_switch_active";
              return (
                csr25Decision?.reason ??
                (Math.abs(edgeBps) >= userLimits.min_edge_bps
                  ? `Edge ${edgeBps}bps exceeds threshold ${userLimits.min_edge_bps}bps`
                  : `Edge ${edgeBps}bps below threshold ${userLimits.min_edge_bps}bps`)
              );
            })(),
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

  // Fetch Price Deviation History from database
  useEffect(() => {
    const fetchPriceHistory = async () => {
      try {
        const response = await fetch(`${API_URL}/api/price-deviation-history`);
        if (response.ok) {
          const data = await response.json();

          // Transform database data to the expected format
          const csrHistory: PriceHistoryPoint[] = [];
          const csr25History: PriceHistoryPoint[] = [];

          data.history.forEach((item: any) => {
            const point = {
              ts: item.timestamp,
              spread_bps: item.spread_bps,
            };

            if (item.market === "csr_usdt") {
              csrHistory.push(point);
            } else if (item.market === "csr25_usdt") {
              csr25History.push(point);
            }
          });

          setState((prev) => ({
            ...prev,
            priceHistory: {
              csr_usdt: csrHistory.slice().reverse(), // Show oldest first
              csr25_usdt: csr25History.slice().reverse(),
            },
          }));

          console.log("Loaded price deviation history from database:", {
            csr: csrHistory.length,
            csr25: csr25History.length,
          });
        }
      } catch (err) {
        console.error("Failed to fetch price deviation history:", err);
      }
    };

    fetchPriceHistory();
  }, []);

  // Fetch user inventory for balance-based calculations
  useEffect(() => {
    const fetchInventory = async () => {
      try {
        // Try to get auth token from localStorage
        const authData = localStorage.getItem("auth");
        if (!authData) return;

        const { accessToken } = JSON.parse(authData);
        if (!accessToken) return;

        const response = await fetch(`${API_URL}/api/me/balances`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (response.ok) {
          const data = await response.json();
          setUserInventory({
            balances: data.balances || [],
            total_usd: data.total_usd || 0,
          });
        }
      } catch (err) {
        console.error("Failed to fetch user inventory:", err);
      }
    };

    fetchInventory();
    const interval = setInterval(fetchInventory, 30000); // Refresh every 30s
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
        {/* User Balances Summary */}
        {userInventory && userInventory.balances.length > 0 && (
          <div className="mb-6 bg-slate-900/50 rounded-xl border border-slate-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">💰 Available for Trading</h3>
              <span className="text-sm text-slate-400">
                Total: ${userInventory.total_usd.toFixed(2)}
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Wallet */}
              <div className="bg-slate-800/50 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-1">
                  🔐 Wallet (DEX)
                </div>
                <div className="space-y-1">
                  {userInventory.balances
                    .filter((b) => b.venue === "Wallet" && b.available > 0)
                    .map((b) => (
                      <div
                        key={b.asset}
                        className="flex justify-between text-sm"
                      >
                        <span>{b.asset}</span>
                        <span className="font-mono">
                          {b.available.toFixed(4)}
                        </span>
                      </div>
                    ))}
                  {userInventory.balances.filter(
                    (b) => b.venue === "Wallet" && b.available > 0
                  ).length === 0 && (
                    <div className="text-xs text-slate-500">No assets</div>
                  )}
                </div>
              </div>
              {/* LBank */}
              <div className="bg-slate-800/50 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-1">🏦 LBank</div>
                <div className="space-y-1">
                  {userInventory.balances
                    .filter((b) => b.venue === "LBank" && b.available > 0)
                    .map((b) => (
                      <div
                        key={b.asset}
                        className="flex justify-between text-sm"
                      >
                        <span>{b.asset}</span>
                        <span className="font-mono">
                          {b.available.toFixed(4)}
                        </span>
                      </div>
                    ))}
                  {userInventory.balances.filter(
                    (b) => b.venue === "LBank" && b.available > 0
                  ).length === 0 && (
                    <div className="text-xs text-slate-500">No assets</div>
                  )}
                </div>
              </div>
              {/* LATOKEN */}
              <div className="bg-slate-800/50 rounded-lg p-3">
                <div className="text-xs text-slate-400 mb-1">🏛️ LATOKEN</div>
                <div className="space-y-1">
                  {userInventory.balances
                    .filter((b) => b.venue === "LATOKEN" && b.available > 0)
                    .map((b) => (
                      <div
                        key={b.asset}
                        className="flex justify-between text-sm"
                      >
                        <span>{b.asset}</span>
                        <span className="font-mono">
                          {b.available.toFixed(4)}
                        </span>
                      </div>
                    ))}
                  {userInventory.balances.filter(
                    (b) => b.venue === "LATOKEN" && b.available > 0
                  ).length === 0 && (
                    <div className="text-xs text-slate-500">No assets</div>
                  )}
                </div>
              </div>
              {/* Trading Capacity */}
              <div className="bg-emerald-900/30 border border-emerald-700/50 rounded-lg p-3">
                <div className="text-xs text-emerald-400 mb-1">
                  ⚡ Ready to Trade
                </div>
                <div className="text-lg font-bold text-emerald-400">
                  $
                  {Math.min(
                    userInventory.balances.find((b) => b.asset === "USDT")
                      ?.available || 0,
                    userInventory.total_usd
                  ).toFixed(2)}
                </div>
                <div className="text-xs text-slate-400">Max single trade</div>
              </div>
            </div>
          </div>
        )}

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
                    <td className="px-4 py-3 text-right">
                      <Tooltip
                        text={
                          userInventory
                            ? `Based on your available balances`
                            : `Market-based estimate`
                        }
                      >
                        <div className="font-mono">
                          ${calculateMaxTradeSize(opp).toFixed(0)}
                        </div>
                        {userInventory &&
                          calculateMaxTradeSize(opp) < opp.max_safe_size && (
                            <div className="text-xs text-amber-400">
                              Limited by balance
                            </div>
                          )}
                      </Tooltip>
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
              defaultExpanded={true}
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
              defaultExpanded={true}
              transactions={[]}
            />
          </div>
        </div>

        {/* Execution Confirmation Modal with Amount Selection */}
        {selectedOpp && (
          <TradeExecutionModal
            opportunity={selectedOpp}
            onClose={() => setSelectedOpp(null)}
            mode={state.mode}
          />
        )}
      </div>
      <Footer />
    </div>
  );
}
