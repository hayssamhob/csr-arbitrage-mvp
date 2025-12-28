/**
 * QuoteLadder - Shows DEX quotes at multiple trade sizes
 * 
 * This is the "source of truth" - actual scraped quotes from Uniswap UI.
 * Required trade sizes MUST come from this ladder, never invented.
 */

import { useMemo } from "react";

interface Quote {
  amountInUSDT: number;
  tokensOut: number;
  executionPrice: number; // USDT per token
  gasEstimateUsdt: number | null;
  valid: boolean;
  reason?: string;
  timestamp?: number;
}

interface QuoteLadderProps {
  token: "CSR" | "CSR25";
  quotes: Quote[];
  cexPrice: number;
  direction: "BUY" | "SELL";
}

// Full ladder from $1 to $1000 as requested
const LADDER_SIZES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

export function QuoteLadder({ token, quotes, cexPrice, direction }: QuoteLadderProps) {
  // Map quotes by size for quick lookup
  const quotesBySize = useMemo(() => {
    const map = new Map<number, Quote>();
    quotes.forEach(q => {
      if (q.valid) {
        // Find closest ladder size
        const closest = LADDER_SIZES.reduce((prev, curr) => 
          Math.abs(curr - q.amountInUSDT) < Math.abs(prev - q.amountInUSDT) ? curr : prev
        );
        if (Math.abs(closest - q.amountInUSDT) < 5) {
          map.set(closest, q);
        }
      }
    });
    return map;
  }, [quotes]);

  // Calculate deviation from CEX price
  const getDeviation = (dexPrice: number) => {
    if (!cexPrice || cexPrice <= 0 || !dexPrice || dexPrice <= 0) return null;
    return ((dexPrice - cexPrice) / cexPrice) * 100;
  };

  const getDeviationColor = (deviation: number | null) => {
    if (deviation === null) return "text-slate-500";
    const abs = Math.abs(deviation);
    if (abs <= 0.5) return "text-emerald-400";
    if (abs <= 1.0) return "text-blue-400";
    if (abs <= 2.0) return "text-yellow-400";
    return "text-red-400";
  };

  const formatPrice = (price: number) => {
    if (!price || price <= 0) return "—";
    if (price < 0.0001) return price.toFixed(8);
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
  };

  const formatTokens = (tokens: number) => {
    if (!tokens || tokens <= 0) return "—";
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(2)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(2)}K`;
    return tokens.toFixed(2);
  };

  return (
    <div className="bg-slate-900/50 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-slate-300 flex items-center gap-2">
          📊 Quote Ladder - {direction === "BUY" ? "USDT → " + token : token + " → USDT"}
        </h4>
        <span className="text-xs text-slate-500">
          CEX Ref: ${formatPrice(cexPrice)}
        </span>
      </div>

      {/* Header */}
      <div className="grid grid-cols-5 gap-2 text-xs text-slate-500 mb-2 pb-2 border-b border-slate-700">
        <div>Size (USDT)</div>
        <div className="text-right">Tokens Out</div>
        <div className="text-right">Exec Price</div>
        <div className="text-right">vs CEX</div>
        <div className="text-right">Gas</div>
      </div>

      {/* Ladder rows */}
      <div className="space-y-1">
        {LADDER_SIZES.map(size => {
          const quote = quotesBySize.get(size);
          const deviation = quote ? getDeviation(quote.executionPrice) : null;
          
          return (
            <div
              key={size}
              className={`grid grid-cols-5 gap-2 text-sm py-1.5 px-1 rounded ${
                quote ? "hover:bg-slate-800/50" : "opacity-50"
              }`}
            >
              <div className="font-mono text-slate-300">${size}</div>
              <div className="text-right font-mono text-slate-300">
                {quote ? formatTokens(quote.tokensOut) : "—"}
              </div>
              <div className="text-right font-mono text-blue-400">
                {quote ? `$${formatPrice(quote.executionPrice)}` : "—"}
              </div>
              <div
                className={`text-right font-mono font-medium ${getDeviationColor(
                  deviation
                )}`}
              >
                {deviation !== null
                  ? `${deviation >= 0 ? "+" : ""}${deviation.toFixed(2)}%`
                  : "—"}
              </div>
              <div className="text-right font-mono text-slate-500">
                {quote &&
                quote.gasEstimateUsdt !== null &&
                quote.gasEstimateUsdt > 0
                  ? `$${quote.gasEstimateUsdt.toFixed(2)}`
                  : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* Summary */}
      <div className="mt-3 pt-3 border-t border-slate-700 text-xs text-slate-500">
        <div className="flex justify-between">
          <span>Quotes available: {quotes.filter(q => q.valid).length}</span>
          <span>Source: UI Scrape</span>
        </div>
        {quotes.length === 0 && (
          <div className="mt-2 text-yellow-400">
            ⚠️ No quotes available - scraper may be down
          </div>
        )}
      </div>
    </div>
  );
}
