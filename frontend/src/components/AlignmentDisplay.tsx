/**
 * AlignmentDisplay - Displays BACKEND alignment data ONLY
 * 
 * This component does NOT compute any required sizes.
 * It displays EXACTLY what /api/alignment returns.
 * All calculations are done server-side.
 */

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
    | "NOT_SUPPORTED_YET"
    | "UNSAFE";
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

interface AlignmentDisplayProps {
  token: "CSR" | "CSR25";
  alignment: BackendAlignment | null;
  onExecute?: (
    token: "CSR" | "CSR25",
    direction: string,
    usdtAmount: number
  ) => void;
  executionMode: "OFF" | "MANUAL" | "AUTO";
}

const TOKEN_NAMES: Record<string, string> = {
  CSR: "CSR/USDT",
  CSR25: "CSR25/USDT",
};

const CEX_SOURCES: Record<string, string> = {
  CSR: "LATOKEN",
  CSR25: "LBank",
};

function formatPrice(price: number | null): string {
  if (price === null || price === 0) return "—";
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return "—";
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return tokens.toFixed(0);
}

export function AlignmentDisplay({
  token,
  alignment,
  onExecute,
  executionMode,
}: AlignmentDisplayProps) {
  // Loading state
  if (!alignment) {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{TOKEN_NAMES[token]}</h2>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-700 text-slate-400">
            LOADING
          </span>
        </div>
        <div className="text-center py-8 text-slate-500">
          <div className="text-4xl mb-3">📡</div>
          <div>Fetching alignment data...</div>
        </div>
      </div>
    );
  }

  // No action state (stale/missing data)
  if (alignment.status === "NO_ACTION") {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border border-yellow-500/30">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{TOKEN_NAMES[token]}</h2>
          <span className="text-xs px-3 py-1 rounded-full bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">
            NO ACTION
          </span>
        </div>
        <div className="bg-yellow-500/10 rounded-xl p-4 mb-4">
          <div className="text-yellow-400 font-medium mb-1">
            ⚠️ Cannot compute alignment
          </div>
          <div className="text-yellow-400/70 text-sm font-mono">
            {alignment.reason}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">
              CEX ({CEX_SOURCES[token]})
            </div>
            <div className="font-mono text-white">
              ${formatPrice(alignment.cex_mid)}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">DEX (Uniswap)</div>
            <div className="font-mono text-white">
              ${formatPrice(alignment.dex_exec_price)}
            </div>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-500">
          Quotes: {alignment.quotes_valid}/{alignment.quotes_available} valid
        </div>
      </div>
    );
  }

  // UNSAFE - alignment not achievable within safe limits
  if (alignment.status === "UNSAFE") {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border-2 border-orange-500/50">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{TOKEN_NAMES[token]}</h2>
          <span className="text-xs px-3 py-1 rounded-full bg-orange-500/20 text-orange-400 border border-orange-500/30 font-bold">
            ⚠️ UNSAFE
          </span>
        </div>
        <div className="bg-orange-500/10 rounded-xl p-4 mb-4 border border-orange-500/20">
          <div className="text-orange-400 font-medium mb-2">
            Alignment not achievable within safe limits
          </div>
          <div className="text-orange-400/70 text-sm font-mono">
            {alignment.reason}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-slate-900/50 rounded-xl p-3">
            <div className="text-xs text-slate-500 mb-1">
              CEX ({CEX_SOURCES[token]})
            </div>
            <div className="font-mono text-lg text-white">
              ${formatPrice(alignment.cex_mid)}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-3">
            <div className="text-xs text-slate-500 mb-1">DEX (Uniswap)</div>
            <div className="font-mono text-lg text-orange-400">
              ${formatPrice(alignment.dex_exec_price)}
            </div>
          </div>
        </div>
        {alignment.required_usdt && (
          <div className="bg-slate-900/50 rounded-lg p-3 text-sm">
            <div className="text-slate-400 mb-2">
              Best safe quote available (doesn't reach target):
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Size:</span>
              <span className="font-mono text-white">
                ${alignment.required_usdt}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Tokens:</span>
              <span className="font-mono text-white">
                {formatTokens(alignment.required_tokens)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Impact:</span>
              <span className="font-mono text-orange-400">
                {alignment.price_impact_pct?.toFixed(2)}%
              </span>
            </div>
          </div>
        )}
        <div className="mt-3 text-xs text-slate-500">
          Quotes: {alignment.quotes_valid}/{alignment.quotes_available} valid
        </div>
      </div>
    );
  }

  // Not supported (SELL direction)
  if (alignment.status === "NOT_SUPPORTED_YET") {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border border-slate-600">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{TOKEN_NAMES[token]}</h2>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-600 text-slate-300">
            SELL NEEDED
          </span>
        </div>
        <div className="bg-slate-700/30 rounded-xl p-4 mb-4">
          <div className="text-slate-300 font-medium mb-1">
            DEX price is HIGH vs CEX
          </div>
          <div className="text-slate-400 text-sm">
            Deviation:{" "}
            <span className="font-mono text-red-400">
              +{alignment.deviation_pct?.toFixed(2)}%
            </span>
          </div>
          <div className="text-slate-500 text-xs mt-2">{alignment.reason}</div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">
              CEX ({CEX_SOURCES[token]})
            </div>
            <div className="font-mono text-white">
              ${formatPrice(alignment.cex_mid)}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">DEX (Uniswap)</div>
            <div className="font-mono text-red-400">
              ${formatPrice(alignment.dex_exec_price)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Aligned state
  if (alignment.status === "ALIGNED") {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border-2 border-emerald-500/30">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{TOKEN_NAMES[token]}</h2>
          <span className="text-xs px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-bold">
            ✓ ALIGNED
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-slate-900/50 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">
              CEX ({CEX_SOURCES[token]})
            </div>
            <div className="font-mono text-2xl text-white">
              ${formatPrice(alignment.cex_mid)}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">DEX (Uniswap)</div>
            <div className="font-mono text-2xl text-emerald-400">
              ${formatPrice(alignment.dex_exec_price)}
            </div>
          </div>
        </div>
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-3">
            <span className="text-2xl">✓</span>
            <div>
              <div className="text-emerald-400 font-medium">Prices Aligned</div>
              <div className="text-emerald-400/70 text-sm">
                Deviation: {alignment.deviation_pct?.toFixed(2)}% (within ±
                {(alignment.band_bps / 100).toFixed(1)}%)
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // BUY_ON_DEX state - THE CORE DISPLAY
  const isActionRequired =
    alignment.status === "BUY_ON_DEX" || alignment.status === "SELL_ON_DEX";
  const isBuy = alignment.direction === "BUY";

  return (
    <div
      className={`bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border-2 ${
        isActionRequired
          ? "border-red-500/50 shadow-xl shadow-red-500/10"
          : "border-slate-700"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          {TOKEN_NAMES[token]}
          <span className="text-xs text-slate-500 font-normal">
            via {CEX_SOURCES[token]}
          </span>
        </h2>
        <span
          className={`text-xs px-3 py-1 rounded-full font-bold ${
            isBuy
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-red-500/20 text-red-400 border border-red-500/30"
          }`}
        >
          {isBuy ? "BUY" : "SELL"} NEEDED
        </span>
      </div>

      {/* Price Comparison */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-slate-900/50 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">CEX Reference</div>
          <div className="font-mono text-2xl text-white">
            ${formatPrice(alignment.cex_mid)}
          </div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">DEX Current</div>
          <div
            className={`font-mono text-2xl ${
              isBuy ? "text-emerald-400" : "text-red-400"
            }`}
          >
            ${formatPrice(alignment.dex_exec_price)}
          </div>
        </div>
      </div>

      {/* Deviation */}
      <div className="mb-4 p-3 rounded-lg bg-slate-900/30">
        <div className="flex justify-between items-center">
          <span className="text-sm text-slate-400">Deviation</span>
          <span
            className={`font-mono text-lg font-bold ${
              isBuy ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {alignment.deviation_pct !== null
              ? `${
                  alignment.deviation_pct > 0 ? "+" : ""
                }${alignment.deviation_pct.toFixed(2)}%`
              : "—"}
          </span>
        </div>
      </div>

      {/* RECOMMENDED ACTION - From Backend */}
      <div
        className={`p-5 rounded-xl border-2 ${
          isBuy
            ? "bg-emerald-500/10 border-emerald-500/30"
            : "bg-red-500/10 border-red-500/30"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className="text-2xl">⚡</span>
            <span className="text-lg font-bold text-white">Required Trade</span>
          </div>
          <span
            className={`px-4 py-2 rounded-lg font-bold text-white ${
              isBuy ? "bg-emerald-600" : "bg-red-600"
            }`}
          >
            {isBuy ? "BUY" : "SELL"} on Uniswap
          </span>
        </div>

        {/* THE CORE ANSWER - From Backend Only */}
        <div className="bg-slate-900/70 rounded-xl p-4 mb-4">
          <div className="text-xs text-slate-400 mb-2">
            Required Trade Size (from backend)
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-mono font-bold text-white">
              {formatTokens(alignment.required_tokens)} {token}
            </span>
            <span className="text-lg font-mono text-slate-400">
              ≈ ${alignment.required_usdt?.toLocaleString() || "—"}
            </span>
          </div>
        </div>

        {/* Expected Outcome */}
        <div className="grid grid-cols-3 gap-3 text-sm mb-4">
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Expected Price</div>
            <div className="font-mono text-emerald-400">
              ${formatPrice(alignment.expected_exec_price)}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Gas Cost</div>
            <div className="font-mono text-slate-300">
              {alignment.network_cost_usd !== null
                ? `~$${alignment.network_cost_usd.toFixed(2)}`
                : "—"}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-1">Price Impact</div>
            <div className="font-mono text-slate-300">
              {alignment.price_impact_pct !== null
                ? `~${alignment.price_impact_pct.toFixed(2)}%`
                : "—"}
            </div>
          </div>
        </div>

        {/* Confidence & Execute */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span
              className={`px-2 py-1 rounded ${
                alignment.confidence === "HIGH"
                  ? "bg-emerald-500/20 text-emerald-400"
                  : alignment.confidence === "MEDIUM"
                  ? "bg-yellow-500/20 text-yellow-400"
                  : "bg-red-500/20 text-red-400"
              }`}
            >
              {alignment.confidence} CONFIDENCE
            </span>
            <span className="text-slate-500">
              {alignment.quotes_valid} quotes
            </span>
          </div>

          {executionMode === "MANUAL" &&
            onExecute &&
            alignment.required_usdt && (
              <button
                onClick={() =>
                  onExecute(
                    token,
                    alignment.direction,
                    alignment.required_usdt!
                  )
                }
                className={`px-6 py-2 rounded-lg font-bold text-white transition-all hover:scale-105 ${
                  isBuy
                    ? "bg-emerald-600 hover:bg-emerald-500"
                    : "bg-red-600 hover:bg-red-500"
                }`}
              >
                Execute Trade →
              </button>
            )}
        </div>
      </div>

      {/* Reason */}
      <div className="mt-4 text-xs text-slate-500 font-mono">
        {alignment.reason}
      </div>
    </div>
  );
}
