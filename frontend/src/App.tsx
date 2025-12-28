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
    <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
      <h3 className="text-xl font-bold text-white mb-4">{title}</h3>

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
            <div className="flex justify-between">
              <span className="text-slate-400">Edge After Costs</span>
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
    <div className="min-h-screen bg-slate-900 text-white p-6">
      {/* Header */}
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">
              CSR Arbitrage Monitor
            </h1>
            <p className="text-slate-400 mt-1">
              Real-time arbitrage opportunity detection
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-400">Last Update</div>
            <div className="text-lg font-mono">
              {timeAgo(lastUpdate.toISOString())}
            </div>
            {error && <div className="text-red-400 text-sm mt-1">{error}</div>}
          </div>
        </div>
      </header>

      {/* System Status Bar */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4 text-slate-300">
          System Status
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Overall</span>
              <StatusBadge
                status={data?.system_status.overall_status || "unknown"}
              />
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">LBank Gateway</span>
              <StatusBadge
                status={data?.system_status.lbank_gateway?.status || "unknown"}
              />
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Uniswap CSR</span>
              <StatusBadge
                status={
                  data?.system_status.uniswap_quote_csr?.status || "unknown"
                }
              />
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Uniswap CSR25</span>
              <StatusBadge
                status={
                  data?.system_status.uniswap_quote_csr25?.status || "unknown"
                }
              />
            </div>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Strategy</span>
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
        <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-slate-400">Execution Mode:</span>
            <span className="px-3 py-1 bg-blue-600 text-white rounded font-bold">
              OFF
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-slate-400">Kill Switch:</span>
            <span className="px-3 py-1 bg-green-600 text-white rounded font-bold">
              ACTIVE
            </span>
          </div>
          <div className="text-sm text-slate-500">
            DRY RUN MODE - No trades executed
          </div>
        </div>
      </section>

      {/* Main Market Cards - Side by Side */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4 text-slate-300">Markets</h2>
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

      {/* Opportunities */}
      {data?.opportunities && data.opportunities.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold mb-4 text-slate-300">
            Active Opportunities
          </h2>
          <div className="space-y-4">
            {data.opportunities.map((opp, i) => (
              <div
                key={i}
                className="bg-green-900/30 border border-green-500 rounded-lg p-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-green-400">
                      {opp.symbol.toUpperCase()}
                    </span>
                    <span className="ml-4 text-slate-300">{opp.direction}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-green-400 font-bold">
                      {opp.edge_after_costs_bps.toFixed(1)} bps edge
                    </span>
                    <span className="ml-4 text-slate-400">
                      Size: ${opp.suggested_size_usdt}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="text-center text-slate-500 text-sm mt-8">
        <p>CSR Arbitrage Monitor - Dry-Run Mode (No Execution)</p>
        <p className="mt-1">Data refreshes automatically via WebSocket</p>
      </footer>
    </div>
  );
}

export default App;
