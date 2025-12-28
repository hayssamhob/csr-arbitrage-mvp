/**
 * QuoteLadder - Shows DEX quotes at multiple trade sizes
 * 
 * This is the "source of truth" - actual scraped quotes from Uniswap UI.
 * Required trade sizes MUST come from this ladder, never invented.
 */

import { useEffect, useState } from "react";

interface LadderQuote {
  usdt_in: number;
  tokens_out: number;
  exec_price: number;
  price_impact_pct: number | null;
  deviation_pct: number | null;
  gas_usdt: number | null;
  age_seconds: number | null;
  valid: boolean;
  error: string | null;
}

interface LadderResponse {
  token: string;
  cex_mid: number | null;
  spot_price: number | null;
  quotes: LadderQuote[];
  total: number;
  valid: number;
}

interface QuoteLadderProps {
  token: "CSR" | "CSR25";
}

export function QuoteLadder({ token }: QuoteLadderProps) {
  const [data, setData] = useState<LadderResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchLadder = async () => {
      try {
        const resp = await fetch(`/api/ladder/${token}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        setData(json);
        setError(null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchLadder();
    const interval = setInterval(fetchLadder, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, [token]);

  // Color code vs CEX: green near 0% (balanced), yellow/orange/red further away
  const getDeviationColor = (deviation: number | null) => {
    if (deviation === null) return "text-slate-500";
    const abs = Math.abs(deviation);
    if (abs <= 0.5) return "text-emerald-400"; // Very close to balance
    if (abs <= 1.0) return "text-emerald-300"; // Close to balance
    if (abs <= 2.0) return "text-yellow-400"; // Moderate deviation
    if (abs <= 5.0) return "text-orange-400"; // High deviation
    return "text-red-400"; // Very high deviation
  };

  // No color coding for Impact - just neutral color
  const getImpactColor = (_impact: number | null) => {
    return "text-slate-300"; // Neutral color for all impact values
  };

  const getAgeColor = (age: number | null) => {
    if (age === null) return "text-slate-500";
    if (age <= 30) return "text-emerald-400";
    if (age <= 60) return "text-blue-400";
    if (age <= 120) return "text-yellow-400";
    return "text-red-400";
  };

  const formatPrice = (price: number | null) => {
    if (!price || price <= 0) return "—";
    if (price < 0.0001) return price.toFixed(8);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
  };

  const formatTokens = (tokens: number | null) => {
    if (!tokens || tokens <= 0) return "—";
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(2)}K`;
    return tokens.toFixed(2);
  };

  if (loading) {
    return (
      <div className="bg-slate-900/50 rounded-lg p-4">
        <div className="animate-pulse text-slate-500">
          Loading quote ladder...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-900/50 rounded-lg p-4">
        <div className="text-red-400">❌ Error: {error}</div>
      </div>
    );
  }

  if (!data || data.quotes.length === 0) {
    return (
      <div className="bg-slate-900/50 rounded-lg p-4">
        <div className="text-yellow-400">
          ⚠️ No quotes available - scraper may be down
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-900/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          📊 Trade Simulations - {token}
        </h4>
        <div className="text-xs text-slate-500">
          CEX: ${formatPrice(data.cex_mid)} | Spot: $
          {formatPrice(data.spot_price)}
        </div>
      </div>

      {/* Header */}
      <div className="grid grid-cols-7 gap-1 text-xs text-slate-500 mb-2 pb-2 border-b border-slate-700">
        <div>USDT In</div>
        <div className="text-right">Tokens Out</div>
        <div className="text-right">Price</div>
        <div className="text-right">Impact</div>
        <div className="text-right">vs CEX</div>
        <div className="text-right">Gas</div>
        <div className="text-right">Age</div>
      </div>

      {/* Ladder rows */}
      <div className="space-y-0.5 max-h-64 overflow-y-auto">
        {data.quotes.map((quote, idx) => (
          <div
            key={idx}
            className={`grid grid-cols-7 gap-1 text-xs py-1.5 px-1 rounded ${
              quote.valid ? "hover:bg-slate-800/50" : "opacity-40 bg-red-900/10"
            }`}
          >
            <div className="font-mono text-slate-300">${quote.usdt_in}</div>
            <div className="text-right font-mono text-slate-300">
              {formatTokens(quote.tokens_out)}
            </div>
            <div className="text-right font-mono text-blue-400">
              ${formatPrice(quote.exec_price)}
            </div>
            <div
              className={`text-right font-mono ${getImpactColor(
                quote.price_impact_pct
              )}`}
            >
              {quote.price_impact_pct !== null
                ? `${quote.price_impact_pct.toFixed(2)}%`
                : "—"}
            </div>
            <div
              className={`text-right font-mono font-medium ${getDeviationColor(
                quote.deviation_pct
              )}`}
            >
              {quote.deviation_pct !== null
                ? `${
                    quote.deviation_pct >= 0 ? "+" : ""
                  }${quote.deviation_pct.toFixed(2)}%`
                : "—"}
            </div>
            <div className="text-right font-mono text-slate-500">
              {quote.gas_usdt !== null ? `$${quote.gas_usdt.toFixed(2)}` : "—"}
            </div>
            <div
              className={`text-right font-mono ${getAgeColor(
                quote.age_seconds
              )}`}
            >
              {quote.age_seconds !== null ? `${quote.age_seconds}s` : "—"}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-500">
        <div className="flex justify-between">
          <span>
            Valid: {data.valid}/{data.total}
          </span>
          <span>Source: Uniswap UI Scrape</span>
        </div>
      </div>
    </div>
  );
}
