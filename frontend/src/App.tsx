import { useEffect, useState } from "react";

// In production (behind nginx), use relative URLs. In dev, use localhost.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "" : "http://localhost:8001");

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
  effective_price_usdt: number;
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
}: {
  title: string;
  market: MarketData;
  lbankHealth?: ServiceHealth;
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

      {/* Uniswap (DEX) Section */}
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
            <div className="flex justify-between">
              <span className="text-slate-400">Price</span>
              <span className="font-mono text-blue-400">
                ${formatPrice(uniswap.effective_price_usdt)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">Source</span>
              <span className="font-mono text-xs">
                {uniswap.source || "unknown"}
              </span>
            </div>
            {uniswap.error ? (
              <div className="text-yellow-400 text-sm">
                {uniswap.error === "Pool not found"
                  ? "Pool not found"
                  : uniswap.error.toLowerCase()}
              </div>
            ) : uniswap.validated ? (
              <div className="text-green-400 text-sm">Price OK</div>
            ) : (
              <div className="text-yellow-400 text-sm">Awaiting validation</div>
            )}
          </div>
        ) : (
          <div className="text-yellow-400 text-sm">No Uniswap data</div>
        )}
      </div>

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

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [error, setError] = useState<string | null>(null);

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
                  CSR Arbitrage Monitor
                </h1>
                <p className="text-slate-400 mt-1">
                  Real-time arbitrage opportunity detection
                </p>
              </div>
            </div>
            <div className="text-right bg-slate-800/50 rounded-lg p-3 border border-slate-700">
              <div className="text-sm text-slate-400">Last Update</div>
              <div className="text-lg font-mono text-emerald-400">
                {timeAgo(lastUpdate.toISOString())}
              </div>
              {error && (
                <div className="text-red-400 text-sm mt-1">{error}</div>
              )}
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
                  className="bg-gradient-to-r from-emerald-900/40 to-green-900/20 border border-emerald-500/50 rounded-lg p-4 shadow-lg shadow-emerald-500/10"
                >
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-emerald-400 text-lg">
                        {opp.symbol.toUpperCase()}
                      </span>
                      <span className="px-2 py-1 bg-slate-700/50 rounded text-slate-300 text-sm">
                        {opp.direction}
                      </span>
                    </div>
                    <div className="text-right flex items-center gap-4">
                      <span className="text-emerald-400 font-bold text-lg">
                        +{opp.edge_after_costs_bps.toFixed(1)} bps
                      </span>
                      <span className="text-slate-400 bg-slate-800/50 px-2 py-1 rounded">
                        ${opp.suggested_size_usdt}
                      </span>
                    </div>
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
            />
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
          <p>CSR Arbitrage Monitor - Dry-Run Mode</p>
          <p className="mt-1 text-slate-600">
            Data refreshes automatically via WebSocket
          </p>
        </footer>
      </div>
    </div>
  );
}

export default App;
