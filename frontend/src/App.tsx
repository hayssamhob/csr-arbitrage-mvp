import { useEffect, useState } from "react";
import { UniswapTradePanel } from "./components/UniswapTradePanel";
import { useWallet } from "./hooks/useWallet";

// In production (behind nginx), use relative URLs. In dev, use localhost.
const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8001");

// WebSocket URL needs full origin in production
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
  amount_in_unit?: string;
  amount_out?: string;
  amount_out_unit?: string;
  effective_price_usdt: number;
  estimated_gas?: number;
  pool_fee?: number;
  price_impact?: number;
  price_impact_percent?: string;
  gas_cost_usdt?: number;
  gas_cost_eth?: string;
  max_slippage?: string;
  order_routing?: string;
  fee_display?: string;
  is_stale: boolean;
  error?: string;
  source?: string;
  validated?: boolean;
}

interface CostBreakdown {
  cex_fee_bps: number;
  dex_lp_fee_bps: number;
  gas_cost_bps: number;
  rebalance_bps: number;
  slippage_bps: number;
}

interface StrategyDecision {
  type: string;
  ts: string;
  symbol: string;
  lbank_bid: number;
  lbank_ask: number;
  uniswap_price: number;
  raw_spread_bps: number;
  estimated_cost_bps: number;
  edge_after_costs_bps: number;
  would_trade: boolean;
  direction: string;
  suggested_size_usdt: number;
  reason: string;
  cost_breakdown?: CostBreakdown;
  cex_source?: string;
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
  decision?: StrategyDecision;
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
  decision?: { csr_usdt?: StrategyDecision; csr25_usdt?: StrategyDecision };
  system_status: SystemStatus;
  opportunities: StrategyDecision[];
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    healthy: "bg-green-500",
    ok: "bg-green-500",
    degraded: "bg-yellow-500",
    error: "bg-red-500",
    unknown: "bg-gray-500",
  };
  return (
    <span
      className={`px-2 py-1 rounded text-xs font-bold text-white ${
        colors[status] || colors.unknown
      }`}
    >
      {status.toUpperCase()}
    </span>
  );
}

function formatPrice(price: number): string {
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
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

function MiniChart({
  data,
  height = 60,
}: {
  data: PricePoint[];
  height?: number;
}) {
  if (data.length < 2) {
    return (
      <div className="text-slate-500 text-xs text-center py-2">
        Collecting data...
      </div>
    );
  }

  const spreads = data.map((p) => p.spread_bps);
  const min = Math.min(...spreads);
  const max = Math.max(...spreads);
  const range = max - min || 1;

  const width = 200;
  const padding = 4;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const points = data
    .map((p, i) => {
      const x = padding + (i / (data.length - 1)) * chartWidth;
      const y =
        padding + chartHeight - ((p.spread_bps - min) / range) * chartHeight;
      return `${x},${y}`;
    })
    .join(" ");

  const lastSpread = spreads[spreads.length - 1];
  const color = lastSpread > 0 ? "#10b981" : "#ef4444";

  return (
    <div className="relative">
      <svg width={width} height={height} className="w-full">
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1={padding}
          y1={height / 2}
          x2={width - padding}
          y2={height / 2}
          stroke="#374151"
          strokeWidth="1"
          strokeDasharray="2,2"
        />
      </svg>
      <div className="absolute top-0 right-0 text-xs">
        <span className={lastSpread > 0 ? "text-emerald-400" : "text-red-400"}>
          {lastSpread > 0 ? "+" : ""}
          {lastSpread.toFixed(0)} bps
        </span>
      </div>
    </div>
  );
}

interface CostBreakdown {
  cex_fee_bps: number;
  dex_lp_fee_bps: number;
  gas_cost_bps: number;
  rebalance_bps: number;
  slippage_bps: number;
}

interface ExtendedDecision extends StrategyDecision {
  cost_breakdown?: CostBreakdown;
  cex_source?: string;
}

function MarketCard({
  title,
  market,
  lbankHealth,
  priceHistory,
  wallet,
  onExecuteTrade,
}: {
  title: string;
  market: MarketData;
  lbankHealth?: ServiceHealth;
  priceHistory?: PricePoint[];
  wallet?: { isConnected: boolean; signer: unknown };
  onExecuteTrade?: (direction: string, size: number, token: string) => void;
}) {
  const lbank = market.lbank_ticker;
  const latoken = market.latoken_ticker;
  const uniswap = market.uniswap_quote;
  const decision = market.decision as ExtendedDecision | undefined;

  // Determine CEX source based on market
  const isCSR =
    title.toLowerCase().includes("csr") &&
    !title.toLowerCase().includes("csr25");
  const cexSource = isCSR ? "LATOKEN" : "LBANK";

  const lbankSymbolKey = title.toLowerCase().includes("csr25")
    ? "csr25_usdt"
    : "csr_usdt";
  const lbankSubscriptionError =
    lbankHealth?.subscription_errors?.[lbankSymbolKey];

  return (
    <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-xl p-6 border border-slate-700 hover:border-emerald-500/30 transition-all shadow-xl">
      <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
        {title}
      </h3>

      {/* CEX Section */}
      <div className="mb-4 p-4 bg-slate-900 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-slate-400 font-medium">{cexSource} (CEX)</span>
          {latoken && isCSR && (
            <span className="text-xs text-slate-500">
              {timeAgo(latoken.ts)}
            </span>
          )}
          {lbank && !isCSR && (
            <span className="text-xs text-slate-500">{timeAgo(lbank.ts)}</span>
          )}
        </div>

        {/* CSR on LATOKEN - show data from latoken_ticker */}
        {isCSR ? (
          latoken ? (
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">Bid</span>
                <span className="font-mono text-green-400">
                  ${formatPrice(latoken.bid)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Ask</span>
                <span className="font-mono text-red-400">
                  ${formatPrice(latoken.ask)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Last</span>
                <span className="font-mono text-white">
                  ${formatPrice(latoken.last)}
                </span>
              </div>
              {latoken.volume_24h !== undefined && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Volume 24h</span>
                  <span className="font-mono text-sm">
                    {latoken.volume_24h.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="text-xs text-green-400 mt-2">
                LATOKEN: Live data
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-yellow-400 text-sm">
                LATOKEN: No data available
              </div>
              <div className="text-xs text-slate-500">
                {decision
                  ? "Waiting for arbitrage calculation..."
                  : "Connection issues - may be geo-restricted"}
              </div>
              <div className="text-xs text-blue-400 mt-2">
                Try deploying on a server outside Indonesia
              </div>
            </div>
          )
        ) : lbank ? (
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Bid</span>
              <span className="font-mono text-green-400">
                ${formatPrice(lbank.bid)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Ask</span>
              <span className="font-mono text-red-400">
                ${formatPrice(lbank.ask)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Last</span>
              <span className="font-mono">${formatPrice(lbank.last)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Volume 24h</span>
              <span className="font-mono text-sm">
                {lbank.volume_24h?.toLocaleString() || "N/A"}
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-yellow-400 text-sm">
              {lbankSubscriptionError
                ? "LBank subscription rejected"
                : "No LBank data"}
            </div>
            {lbankSubscriptionError ? (
              <div className="text-xs text-slate-500">
                {lbankSubscriptionError}
              </div>
            ) : (
              <div className="text-xs text-slate-500">
                Waiting for ticker stream
              </div>
            )}
          </div>
        )}
      </div>

      {/* Uniswap (DEX) Section - Uniswap-style display */}
      <div className="mb-4 p-4 bg-slate-900 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-slate-400 font-medium">Uniswap (DEX)</span>
          {uniswap && (
            <span className="text-xs text-slate-500">
              {timeAgo(uniswap.ts)}
            </span>
          )}
        </div>
        {uniswap ? (
          <div className="space-y-2">
            {/* Price per token - Uniswap style */}
            <div className="flex justify-between items-center">
              <span className="text-slate-400">Price</span>
              <span className="font-mono text-blue-400 font-bold">
                ${formatPrice(uniswap.effective_price_usdt)}
              </span>
            </div>
            <div className="text-xs text-slate-500 text-right">
              1 {uniswap.amount_out_unit} ={" "}
              {formatPrice(uniswap.effective_price_usdt)} USDT
            </div>

            {/* Uniswap-style info rows */}
            <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Fee</span>
                <span className="text-emerald-400">
                  {uniswap.fee_display || "Free"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Network cost</span>
                <span className="text-slate-300">
                  ${(uniswap.gas_cost_usdt || 0.02).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Order routing</span>
                <span className="text-slate-300">
                  {uniswap.order_routing || "Uniswap API"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Price impact</span>
                <span
                  className={`${
                    (uniswap.price_impact || 0) < -1
                      ? "text-yellow-400"
                      : "text-slate-300"
                  }`}
                >
                  {uniswap.price_impact_percent ||
                    `${(uniswap.price_impact || -0.05).toFixed(2)}%`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Max slippage</span>
                <span className="text-slate-300">
                  {uniswap.max_slippage || "Auto / 0.50%"}
                </span>
              </div>
            </div>

            {uniswap.error ? (
              <div className="text-yellow-400 text-sm mt-2">
                {uniswap.error === "Pool not found"
                  ? "Pool not found"
                  : uniswap.error.toLowerCase()}
              </div>
            ) : uniswap.validated ? (
              <div className="text-emerald-400 text-xs mt-2 flex items-center gap-1">
                <span>✓</span> Real-time quote
              </div>
            ) : (
              <div className="text-yellow-400 text-sm mt-2">
                Awaiting validation
              </div>
            )}
          </div>
        ) : (
          <div className="text-yellow-400 text-sm">No Uniswap data</div>
        )}
      </div>

      {/* Arbitrage Calculator */}
      {uniswap && (isCSR ? latoken : lbank) && (
        <div className="mb-4 p-4 bg-slate-900 rounded-lg">
          <div className="text-slate-400 font-medium mb-2">
            Arbitrage Calculator
          </div>
          <div className="space-y-2 text-sm">
            {(() => {
              // Fixed: proper parentheses for CEX mid-price
              const cexBid = isCSR ? latoken?.bid || 0 : lbank?.bid || 0;
              const cexAsk = isCSR ? latoken?.ask || 0 : lbank?.ask || 0;
              const cexMidPrice = (cexBid + cexAsk) / 2;
              const dexPrice = uniswap.effective_price_usdt;
              const priceDiffPct = ((cexMidPrice - dexPrice) / dexPrice) * 100;
              const buyOnDex = cexMidPrice > dexPrice;

              if (Math.abs(priceDiffPct) < 0.1) {
                return (
                  <div className="text-slate-500">
                    Prices balanced (within 0.1%)
                  </div>
                );
              }

              const targetSize = 1000;
              const tokensFor1000 = targetSize / dexPrice;
              const grossProfit =
                Math.abs(cexMidPrice - dexPrice) * tokensFor1000;

              return (
                <>
                  <div className="flex justify-between">
                    <span className="text-slate-400">CEX Mid</span>
                    <span className="font-mono">
                      ${formatPrice(cexMidPrice)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">DEX Mid</span>
                    <span className="font-mono">${formatPrice(dexPrice)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Gap</span>
                    <span
                      className={`font-mono ${
                        priceDiffPct > 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {priceDiffPct > 0 ? "+" : ""}
                      {priceDiffPct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="border-t border-slate-700 pt-2 mt-2">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Strategy</span>
                      <span
                        className={
                          buyOnDex ? "text-emerald-400" : "text-blue-400"
                        }
                      >
                        {buyOnDex ? "Buy DEX → Sell CEX" : "Buy CEX → Sell DEX"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">$1000 gets</span>
                      <span className="font-mono">
                        {tokensFor1000.toFixed(2)} tokens
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Gross Profit</span>
                      <span className="font-mono text-emerald-400">
                        ${grossProfit.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Spread & Edge Section */}
      <div className="mb-4 p-4 bg-slate-900 rounded-lg">
        <div className="text-slate-400 font-medium mb-2">Spread & Edge</div>
        {decision ? (
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Raw Spread</span>
              <span
                className={`font-mono ${
                  decision.raw_spread_bps > 0
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {decision.raw_spread_bps.toFixed(1)} bps
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Est. Costs</span>
              <span className="font-mono text-orange-400">
                {decision.estimated_cost_bps} bps
              </span>
            </div>
            {decision.cost_breakdown && (
              <div className="text-xs text-slate-500 pl-2 border-l border-slate-700 space-y-1">
                <div className="flex justify-between">
                  <span>CEX Fee</span>
                  <span>{decision.cost_breakdown.cex_fee_bps} bps</span>
                </div>
                <div className="flex justify-between">
                  <span>DEX LP Fee</span>
                  <span>{decision.cost_breakdown.dex_lp_fee_bps} bps</span>
                </div>
                <div className="flex justify-between">
                  <span>Gas</span>
                  <span>{decision.cost_breakdown.gas_cost_bps} bps</span>
                </div>
                <div className="flex justify-between">
                  <span>Slippage Buffer</span>
                  <span>{decision.cost_breakdown.slippage_bps} bps</span>
                </div>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-slate-700">
              <span className="text-slate-400 font-medium">
                Edge After Costs
              </span>
              <span
                className={`font-mono font-bold ${
                  decision.edge_after_costs_bps > 0
                    ? "text-green-400"
                    : "text-red-400"
                }`}
              >
                {decision.edge_after_costs_bps.toFixed(1)} bps
              </span>
            </div>
          </div>
        ) : (
          <div className="text-slate-500 text-sm">Awaiting data</div>
        )}
      </div>

      {/* Spread History Chart */}
      {priceHistory && priceHistory.length > 0 && (
        <div className="mb-4 p-4 bg-slate-900 rounded-lg">
          <div className="text-slate-400 font-medium mb-2">Spread History</div>
          <MiniChart data={priceHistory} height={50} />
        </div>
      )}

      {/* Decision Section */}
      <div className="p-4 bg-slate-900 rounded-lg">
        <div className="text-slate-400 font-medium mb-2">Decision</div>
        {decision ? (
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-slate-400">Would Trade</span>
              <span
                className={`font-bold ${
                  decision.would_trade ? "text-green-400" : "text-slate-400"
                }`}
              >
                {decision.would_trade ? "YES" : "NO"}
              </span>
            </div>
            {decision.would_trade && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-400">Direction</span>
                  <span className="font-mono text-sm">
                    {decision.direction}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Suggested Size</span>
                  <span className="font-mono">
                    ${decision.suggested_size_usdt}
                  </span>
                </div>
                <button
                  className={`w-full mt-3 px-4 py-2 ${
                    wallet?.isConnected
                      ? "bg-emerald-600 hover:bg-emerald-500"
                      : "bg-slate-600 cursor-not-allowed"
                  } text-white rounded-lg font-bold transition-colors flex items-center justify-center gap-2`}
                  disabled={!wallet?.isConnected}
                  onClick={() => {
                    if (!wallet?.isConnected) {
                      alert("Please connect your wallet first");
                      return;
                    }
                    const token = isCSR ? "CSR" : "CSR25";
                    const confirmed = window.confirm(
                      `⚠️ EXECUTE TRADE?\n\n` +
                        `Direction: ${decision.direction}\n` +
                        `Token: ${token}\n` +
                        `Size: $${decision.suggested_size_usdt} USDT\n` +
                        `Expected Edge: ${decision.edge_after_costs_bps.toFixed(
                          1
                        )} bps\n\n` +
                        `This will execute a REAL trade on Uniswap. Are you sure?`
                    );
                    if (confirmed && onExecuteTrade) {
                      onExecuteTrade(
                        decision.direction,
                        decision.suggested_size_usdt,
                        token
                      );
                    }
                  }}
                >
                  <span>⚡</span>{" "}
                  {wallet?.isConnected
                    ? "Execute Trade"
                    : "Connect Wallet First"}
                </button>
              </>
            )}
            <div className="text-xs text-slate-500 mt-2">{decision.reason}</div>
          </div>
        ) : (
          <div className="text-slate-500 text-sm">No decision yet</div>
        )}
      </div>
    </div>
  );
}

interface PriceHistoryState {
  csr_usdt: PricePoint[];
  csr25_usdt: PricePoint[];
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [error, setError] = useState<string | null>(null);
  const [priceHistory, setPriceHistory] = useState<PriceHistoryState>({
    csr_usdt: [],
    csr25_usdt: [],
  });

  // Wallet integration
  const wallet = useWallet();

  // Trade panel state
  const [showTradePanel, setShowTradePanel] = useState<{
    token: "CSR" | "CSR25";
    direction: "buy" | "sell";
  } | null>(null);

  // Handle trade button click - opens the trade panel
  const handleExecuteTrade = (
    direction: string,
    _size: number,
    token: string
  ) => {
    const isBuyDex = direction === "buy_dex_sell_cex";
    setShowTradePanel({
      token: token as "CSR" | "CSR25",
      direction: isBuyDex ? "buy" : "sell",
    });
  };

  // Fetch price history periodically
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

  // Fetch data immediately on mount for instant loading
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

  useEffect(() => {
    let ws: WebSocket | null = null;

    function connect() {
      ws = new WebSocket(getWsUrl());

      ws.onopen = () => {
        setError(null);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setData(parsed);
          setLastUpdate(new Date());
        } catch {
          console.error("Failed to parse WS message");
        }
      };

      ws.onerror = () => {
        setError("WebSocket error");
      };

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
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 text-white px-4 sm:px-6 lg:px-8 py-6">
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
                  ? data.market_state?.csr_usdt?.uniswap_quote
                      ?.effective_price_usdt || 0
                  : data.market_state?.csr25_usdt?.uniswap_quote
                      ?.effective_price_usdt || 0
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

      <div className="max-w-6xl mx-auto w-full">
        {/* Header */}
        <header className="mb-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <img
                src="/depollute-logo-256.png"
                alt="Depollute Now!"
                className="h-16 w-16 rounded-lg shadow-lg shadow-emerald-500/20"
              />
              <div>
                <h1 className="text-3xl font-bold bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent">
                  Depollute Now!
                </h1>
                <p className="text-slate-400 mt-1">CSR Trading Platform</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                <div className="text-sm text-slate-400">Last Update</div>
                <div className="text-lg font-mono text-emerald-400">
                  {timeAgo(lastUpdate.toISOString())}
                </div>
                {error && (
                  <div className="text-red-400 text-sm mt-1">{error}</div>
                )}
              </div>
              {/* Wallet Connection */}
              <div className="bg-slate-800/50 rounded-lg p-3 border border-slate-700">
                {wallet.isConnected ? (
                  <div className="text-right">
                    <div className="text-xs text-slate-400">Wallet</div>
                    <div className="font-mono text-sm text-emerald-400">
                      {wallet.address?.slice(0, 6)}...
                      {wallet.address?.slice(-4)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {wallet.chainId === 1
                        ? "Ethereum"
                        : `Chain ${wallet.chainId}`}
                    </div>
                    <div className="flex gap-2 mt-1 justify-end">
                      <button
                        onClick={async () => {
                          wallet.disconnect();
                          setTimeout(() => wallet.connect(), 100);
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300"
                      >
                        Switch
                      </button>
                      <button
                        onClick={wallet.disconnect}
                        className="text-xs text-red-400 hover:text-red-300"
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={wallet.connect}
                    disabled={wallet.isConnecting}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white rounded-lg font-medium text-sm transition-colors"
                  >
                    {wallet.isConnecting
                      ? "Connecting..."
                      : "🦊 Connect Wallet"}
                  </button>
                )}
                {wallet.error && (
                  <div className="text-red-400 text-xs mt-1">
                    {wallet.error}
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* System Status Bar */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-emerald-400">
            System Status
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="bg-slate-800/70 rounded-lg p-3 border border-slate-700 hover:border-emerald-500/50 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Overall</span>
                <StatusBadge
                  status={data?.system_status.overall_status || "unknown"}
                />
              </div>
            </div>
            <a
              href="https://www.lbank.com/trade/csr25_usdt"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-slate-800/70 rounded-lg p-3 border border-slate-700 hover:border-emerald-500/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">LBank ↗</span>
                <StatusBadge
                  status={
                    data?.system_status.lbank_gateway?.status || "unknown"
                  }
                />
              </div>
            </a>
            <a
              href="https://latoken.com/exchange/CSR_USDT"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-slate-800/70 rounded-lg p-3 border border-slate-700 hover:border-emerald-500/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">LATOKEN ↗</span>
                <StatusBadge
                  status={
                    data?.system_status.latoken_gateway?.status || "unknown"
                  }
                />
              </div>
            </a>
            <a
              href="https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0xdAC17F958D2ee523a2206206994597C13D831ec7&outputCurrency=0x75Ecb52e403C617679FBd3e77A50f9d10A842387"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-slate-800/70 rounded-lg p-3 border border-slate-700 hover:border-emerald-500/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Uniswap CSR ↗</span>
                <StatusBadge
                  status={
                    data?.system_status.uniswap_quote_csr?.status || "unknown"
                  }
                />
              </div>
            </a>
            <a
              href="https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0xdAC17F958D2ee523a2206206994597C13D831ec7&outputCurrency=0x502E7230E142A332DFEd1095F7174834b2548982"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-slate-800/70 rounded-lg p-3 border border-slate-700 hover:border-emerald-500/50 transition-colors cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Uniswap CSR25 ↗</span>
                <StatusBadge
                  status={
                    data?.system_status.uniswap_quote_csr25?.status || "unknown"
                  }
                />
              </div>
            </a>
            <div className="bg-slate-800/70 rounded-lg p-3 border border-slate-700 hover:border-emerald-500/50 transition-colors">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">Strategy</span>
                <StatusBadge
                  status={
                    data?.system_status.strategy_engine?.status || "unknown"
                  }
                />
              </div>
            </div>
          </div>
        </section>

        {/* Execution Mode Banner */}
        <section className="mb-8">
          <div className="bg-gradient-to-r from-slate-800/80 to-emerald-900/30 border border-emerald-500/30 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="text-slate-400">Execution Mode:</span>
              <span className="px-3 py-1 bg-blue-600/80 text-white rounded-full font-bold text-sm">
                OFF
              </span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-slate-400">Kill Switch:</span>
              <span className="px-3 py-1 bg-emerald-600/80 text-white rounded-full font-bold text-sm animate-pulse">
                ACTIVE
              </span>
            </div>
            <div className="text-sm text-emerald-400/70 font-medium">
              🛡️ DRY RUN MODE - No trades executed
            </div>
          </div>
        </section>

        {/* Opportunities */}
        {data?.opportunities && data.opportunities.length > 0 && (
          <section className="mb-8">
            <h2 className="text-xl font-semibold mb-4 text-emerald-400 flex items-center gap-2">
              <span className="animate-pulse">🎯</span> Active Opportunities
            </h2>
            <div className="space-y-3">
              {data.opportunities.map((opp, i) => (
                <div
                  key={i}
                  onClick={() => {
                    const token = opp.symbol.includes("csr25")
                      ? "CSR25"
                      : "CSR";
                    const direction =
                      opp.direction === "buy_dex_sell_cex" ? "buy" : "sell";
                    setShowTradePanel({
                      token: token as "CSR" | "CSR25",
                      direction: direction as "buy" | "sell",
                    });
                  }}
                  className="bg-gradient-to-r from-emerald-900/40 to-green-900/20 border border-emerald-500/50 rounded-lg p-4 shadow-lg shadow-emerald-500/10 cursor-pointer hover:border-emerald-400 hover:shadow-emerald-500/30 transition-all"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-emerald-400 text-lg">
                        {opp.symbol.toUpperCase()}
                      </span>
                      <span className="px-2 py-1 bg-slate-700/50 rounded text-slate-300 text-sm">
                        {opp.direction === "buy_dex_sell_cex"
                          ? "Buy DEX → Sell CEX"
                          : "Buy CEX → Sell DEX"}
                      </span>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <div className="text-right">
                        <div className="text-emerald-400 font-bold text-lg">
                          +{opp.edge_after_costs_bps.toFixed(1)} bps
                        </div>
                        <div className="text-xs text-slate-500">
                          Raw: {opp.raw_spread_bps.toFixed(0)} − Costs:{" "}
                          {opp.estimated_cost_bps.toFixed(0)}
                        </div>
                      </div>
                      <span className="text-slate-400 bg-slate-800/50 px-2 py-1 rounded">
                        ${opp.suggested_size_usdt}
                      </span>
                      <span className="text-emerald-400 text-xl">→</span>
                    </div>
                  </div>
                  {/* Fees breakdown */}
                  <div className="mt-2 pt-2 border-t border-slate-700/50 text-xs text-slate-500 flex flex-wrap gap-3">
                    <span>
                      CEX Fee: {opp.cost_breakdown?.cex_fee_bps || 20} bps
                    </span>
                    <span>
                      DEX LP: {opp.cost_breakdown?.dex_lp_fee_bps || 30} bps
                    </span>
                    <span>
                      Gas: {opp.cost_breakdown?.gas_cost_bps?.toFixed(1) || 50}{" "}
                      bps
                    </span>
                    <span>
                      Slippage: {opp.cost_breakdown?.slippage_bps || 10} bps
                    </span>
                    <span className="ml-auto text-emerald-500/70">
                      Click to trade →
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Main Market Cards - Side by Side */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-emerald-400">
            Markets
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <MarketCard
              title="CSR / USDT"
              market={
                data?.market_state?.csr_usdt || {
                  lbank_ticker: undefined,
                  uniswap_quote: undefined,
                  decision: undefined,
                }
              }
              lbankHealth={data?.system_status.lbank_gateway}
              priceHistory={priceHistory.csr_usdt}
              wallet={{
                isConnected: wallet.isConnected,
                signer: wallet.signer,
              }}
              onExecuteTrade={handleExecuteTrade}
            />
            <MarketCard
              title="CSR25 / USDT"
              market={
                data?.market_state?.csr25_usdt || {
                  lbank_ticker: undefined,
                  uniswap_quote: undefined,
                  decision: undefined,
                }
              }
              lbankHealth={data?.system_status.lbank_gateway}
              priceHistory={priceHistory.csr25_usdt}
              wallet={{
                isConnected: wallet.isConnected,
                signer: wallet.signer,
              }}
              onExecuteTrade={handleExecuteTrade}
            />
          </div>
        </section>

        {/* Transaction History Section */}
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-emerald-400 flex items-center gap-2">
            📜 Transaction History
          </h2>
          <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-xl p-6 border border-slate-700">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="text-left py-3 px-2">Time</th>
                    <th className="text-left py-3 px-2">Pair</th>
                    <th className="text-left py-3 px-2">Direction</th>
                    <th className="text-right py-3 px-2">CEX Price</th>
                    <th className="text-right py-3 px-2">DEX Price</th>
                    <th className="text-right py-3 px-2">Edge (bps)</th>
                    <th className="text-right py-3 px-2">Size</th>
                    <th className="text-center py-3 px-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Sample dry-run decision history - in production would come from backend */}
                  {data?.opportunities && data.opportunities.length > 0 ? (
                    data.opportunities.map((opp, i) => (
                      <tr
                        key={i}
                        className="border-b border-slate-700/50 hover:bg-slate-800/50"
                      >
                        <td className="py-3 px-2 text-slate-400">
                          {new Date(opp.ts).toLocaleTimeString()}
                        </td>
                        <td className="py-3 px-2 font-medium text-white">
                          {opp.symbol.toUpperCase()}
                        </td>
                        <td className="py-3 px-2">
                          <span
                            className={`px-2 py-1 rounded text-xs ${
                              opp.direction === "buy_dex_sell_cex"
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-purple-500/20 text-purple-400"
                            }`}
                          >
                            {opp.direction === "buy_dex_sell_cex"
                              ? "DEX→CEX"
                              : "CEX→DEX"}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-slate-300">
                          ${formatPrice(opp.lbank_ask)}
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-blue-400">
                          ${formatPrice(opp.uniswap_price)}
                        </td>
                        <td className="py-3 px-2 text-right">
                          <span className="text-emerald-400 font-medium">
                            +{opp.edge_after_costs_bps.toFixed(1)}
                          </span>
                        </td>
                        <td className="py-3 px-2 text-right font-mono text-slate-300">
                          ${opp.suggested_size_usdt}
                        </td>
                        <td className="py-3 px-2 text-center">
                          <span className="px-2 py-1 rounded text-xs bg-yellow-500/20 text-yellow-400">
                            Dry Run
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-8 text-center text-slate-500"
                      >
                        No trading opportunities detected yet. Monitoring
                        markets...
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="mt-4 pt-4 border-t border-slate-700 flex items-center justify-between text-xs text-slate-500">
              <span>⚠️ DRY RUN MODE - No actual trades executed</span>
              <span>
                Showing latest {data?.opportunities?.length || 0} opportunities
              </span>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-slate-500 text-sm mt-12 pb-4">
          <div className="flex items-center justify-center gap-2 mb-2">
            <img
              src="/depollute-logo-256.png"
              alt="Depollute"
              className="h-6 w-6 opacity-50"
            />
            <span className="text-emerald-400/50">Depollute Now!</span>
          </div>
          <p>Depollute Now! CSR Trading Platform</p>
          <p className="mt-1 text-slate-600">
            Data refreshes automatically via WebSocket
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
