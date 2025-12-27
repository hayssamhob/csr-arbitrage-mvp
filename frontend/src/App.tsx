import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

interface ServiceHealth {
  service: string
  status: string
  ts: string
  is_stale: boolean
  connected: boolean
  last_message_ts?: string
  reconnect_count: number
  errors_last_5m: number
}

interface LBankTicker {
  type: string
  symbol: string
  ts: string
  bid: number
  ask: number
  last: number
  volume_24h: number
}

interface UniswapQuote {
  type: string
  pair: string
  chain_id: number
  ts: string
  amount_in: string
  effective_price_usdt: number
  is_stale: boolean
  error?: string
}

interface StrategyDecision {
  type: string
  ts: string
  symbol: string
  lbank_bid: number
  lbank_ask: number
  uniswap_price: number
  raw_spread_bps: number
  estimated_cost_bps: number
  edge_after_costs_bps: number
  would_trade: boolean
  direction: string
  suggested_size_usdt: number
  reason: string
}

interface MarketState {
  ts: string;
  lbank_ticker?: LBankTicker;
  uniswap_quote?: UniswapQuote;
  uniswap_quote_csr?: UniswapQuote;
  uniswap_quote_csr25?: UniswapQuote;
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
  decision?: StrategyDecision;
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

function formatBps(bps: number): string {
  return `${bps.toFixed(1)} bps`;
}

function formatPercent(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function timeAgo(ts: string): string {
  const now = new Date();
  const then = new Date(ts);
  const diff = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: number | null = null;

    const connect = () => {
      try {
        ws = new WebSocket(`${API_URL.replace("http", "ws")}/ws`);

        ws.onopen = () => {
          setError(null);
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            setData(parsed);
            setLastUpdate(new Date());
          } catch (e) {
            console.error("Failed to parse message:", e);
          }
        };

        ws.onclose = () => {
          reconnectTimeout = window.setTimeout(connect, 2000);
        };

        ws.onerror = () => {
          setError("WebSocket connection failed");
        };
      } catch (e) {
        setError("Failed to connect");
        reconnectTimeout = window.setTimeout(connect, 2000);
      }
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Fallback to polling if WebSocket fails
  useEffect(() => {
    if (error) {
      const interval = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/dashboard`);
          if (res.ok) {
            const parsed = await res.json();
            setData(parsed);
            setLastUpdate(new Date());
            setError(null);
          }
        } catch (e) {
          console.error("Polling failed:", e);
        }
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
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

      {/* System Status */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4 text-slate-300">
          System Status
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
            {data?.system_status.lbank_gateway && (
              <div className="text-xs text-slate-500">
                {data.system_status.lbank_gateway.connected
                  ? "🟢 Connected"
                  : "🔴 Disconnected"}
                {data.system_status.lbank_gateway.last_message_ts && (
                  <span className="ml-2">
                    {timeAgo(data.system_status.lbank_gateway.last_message_ts)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Uniswap Quote (CSR25)</span>
              <StatusBadge
                status={
                  data?.system_status.uniswap_quote_csr25?.status || "unknown"
                }
              />
            </div>
          </div>

          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Uniswap Quote (CSR)</span>
              <StatusBadge
                status={
                  data?.system_status.uniswap_quote_csr?.status || "unknown"
                }
              />
            </div>
          </div>

          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-slate-400">Strategy Engine</span>
              <StatusBadge
                status={
                  data?.system_status.strategy_engine?.status || "unknown"
                }
              />
            </div>
          </div>
        </div>
      </section>

      {/* Arbitrage Opportunity */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4 text-slate-300">
          Current Opportunity
        </h2>
        {data?.decision ? (
          <div
            className={`bg-slate-800 rounded-lg p-6 border-2 ${
              data.decision.would_trade
                ? "border-green-500"
                : "border-slate-700"
            }`}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <span className="text-2xl font-bold">
                  {data.decision.symbol.toUpperCase()}
                </span>
                {data.decision.would_trade && (
                  <span className="bg-green-500 text-white px-3 py-1 rounded-full text-sm font-bold animate-pulse">
                    OPPORTUNITY DETECTED
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-sm text-slate-400">Direction</div>
                <div className="font-mono text-lg">
                  {data.decision.direction.replace(/_/g, " ").toUpperCase()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-sm text-slate-400 mb-1">LBank Bid</div>
                <div className="text-xl font-mono">
                  ${formatPrice(data.decision.lbank_bid)}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">LBank Ask</div>
                <div className="text-xl font-mono">
                  ${formatPrice(data.decision.lbank_ask)}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">Uniswap Price</div>
                <div className="text-xl font-mono">
                  ${formatPrice(data.decision.uniswap_price)}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">
                  Suggested Size
                </div>
                <div className="text-xl font-mono">
                  ${data.decision.suggested_size_usdt.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 mt-6 pt-6 border-t border-slate-700">
              <div>
                <div className="text-sm text-slate-400 mb-1">Raw Spread</div>
                <div className="text-2xl font-bold text-blue-400">
                  {formatPercent(data.decision.raw_spread_bps)}
                </div>
                <div className="text-xs text-slate-500">
                  {formatBps(data.decision.raw_spread_bps)}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">Est. Costs</div>
                <div className="text-2xl font-bold text-orange-400">
                  {formatPercent(data.decision.estimated_cost_bps)}
                </div>
                <div className="text-xs text-slate-500">
                  {formatBps(data.decision.estimated_cost_bps)}
                </div>
              </div>
              <div>
                <div className="text-sm text-slate-400 mb-1">
                  Edge After Costs
                </div>
                <div
                  className={`text-2xl font-bold ${
                    data.decision.edge_after_costs_bps > 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {formatPercent(data.decision.edge_after_costs_bps)}
                </div>
                <div className="text-xs text-slate-500">
                  {formatBps(data.decision.edge_after_costs_bps)}
                </div>
              </div>
            </div>

            <div className="mt-4 p-3 bg-slate-900 rounded text-sm text-slate-400">
              {data.decision.reason}
            </div>
          </div>
        ) : (
          <div className="bg-slate-800 rounded-lg p-6 border border-slate-700 text-center text-slate-500">
            No arbitrage decision available yet
          </div>
        )}
      </section>

      {/* Market Data */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4 text-slate-300">
          Market Data
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* LBank Data */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span>📊</span> LBank (CEX)
            </h3>
            {data?.market_state?.lbank_ticker ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Symbol</span>
                  <span className="font-mono">
                    {data.market_state.lbank_ticker.symbol.toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Last Price</span>
                  <span className="font-mono">
                    ${formatPrice(data.market_state.lbank_ticker.last)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Bid</span>
                  <span className="font-mono text-green-400">
                    ${formatPrice(data.market_state.lbank_ticker.bid)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Ask</span>
                  <span className="font-mono text-red-400">
                    ${formatPrice(data.market_state.lbank_ticker.ask)}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-2">
                  Updated: {timeAgo(data.market_state.lbank_ticker.ts)}
                </div>
              </div>
            ) : (
              <div className="text-slate-500">No data available</div>
            )}
          </div>

          {/* Uniswap Data - CSR25 */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span>🦄</span> Uniswap (DEX) - CSR25
            </h3>
            {data?.market_state?.uniswap_quote_csr25 ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Pair</span>
                  <span className="font-mono">
                    {data.market_state.uniswap_quote_csr25.pair}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Effective Price</span>
                  <span className="font-mono">
                    $
                    {formatPrice(
                      data.market_state.uniswap_quote_csr25.effective_price_usdt
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Quote Size</span>
                  <span className="font-mono">
                    ${data.market_state.uniswap_quote_csr25.amount_in} USDT
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Chain</span>
                  <span className="font-mono">
                    Ethereum (ID:{" "}
                    {data.market_state.uniswap_quote_csr25.chain_id})
                  </span>
                </div>
                {data.market_state.uniswap_quote_csr25.error ? (
                  <div className="text-yellow-400 text-sm mt-2">
                    {data.market_state.uniswap_quote_csr25.error ===
                    "Pool not found"
                      ? "Uniswap price: unavailable (v4 pool not found)"
                      : `Uniswap price: ${data.market_state.uniswap_quote_csr25.error.toLowerCase()}`}
                  </div>
                ) : (
                  <div className="text-green-400 text-sm mt-2">
                    Uniswap price: OK (v4 subgraph)
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-2">
                  Updated: {timeAgo(data.market_state.uniswap_quote_csr25.ts)}
                </div>
              </div>
            ) : (
              <div className="text-slate-500">No data available</div>
            )}
          </div>

          {/* Uniswap Data - CSR */}
          <div className="bg-slate-800 rounded-lg p-4 border border-slate-700">
            <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <span>🦄</span> Uniswap (DEX) - CSR
            </h3>
            {data?.market_state?.uniswap_quote_csr ? (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-400">Pair</span>
                  <span className="font-mono">
                    {data.market_state.uniswap_quote_csr.pair}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Effective Price</span>
                  <span className="font-mono">
                    $
                    {formatPrice(
                      data.market_state.uniswap_quote_csr.effective_price_usdt
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Quote Size</span>
                  <span className="font-mono">
                    ${data.market_state.uniswap_quote_csr.amount_in} USDT
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Chain</span>
                  <span className="font-mono">
                    Ethereum (ID: {data.market_state.uniswap_quote_csr.chain_id}
                    )
                  </span>
                </div>
                {data.market_state.uniswap_quote_csr.error ? (
                  <div className="text-yellow-400 text-sm mt-2">
                    {data.market_state.uniswap_quote_csr.error ===
                    "Pool not found"
                      ? "Uniswap price: unavailable (v4 pool not found)"
                      : `Uniswap price: ${data.market_state.uniswap_quote_csr.error.toLowerCase()}`}
                  </div>
                ) : (
                  <div className="text-green-400 text-sm mt-2">
                    Uniswap price: OK (v4 pool state)
                  </div>
                )}
                <div className="text-xs text-slate-500 mt-2">
                  Updated: {timeAgo(data.market_state.uniswap_quote_csr.ts)}
                </div>
              </div>
            ) : (
              <div className="text-slate-500">No data available</div>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="text-center text-slate-500 text-sm mt-8">
        <p>CSR Arbitrage Monitor • Dry-Run Mode (No Execution)</p>
        <p className="mt-1">Data refreshes automatically via WebSocket</p>
      </footer>
    </div>
  );
}

export default App
