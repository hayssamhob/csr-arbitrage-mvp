/**
 * PriceAlignmentCard - Primary UI Component
 * 
 * This is THE dominant card that answers the core question:
 * "How many tokens do I need to buy or sell on Uniswap right now 
 * to bring the DEX price back in line with the CEX reference price?"
 */

import { useMemo } from "react";
import type { AlignmentResult, DexQuote, TokenConfig } from "../lib/alignmentEngine";
import {
    computeDexAlignment,
    formatDeviation,
    formatPrice,
    formatTokenAmount,
    getBandStyle,
    TOKEN_CONFIGS,
} from "../lib/alignmentEngine";

interface PriceAlignmentCardProps {
  token: "CSR" | "CSR25";
  cexPrice: number;
  dexQuotes: DexQuote[];
  onExecute?: (direction: string, tokenAmount: number) => void;
  executionMode: "OFF" | "MANUAL" | "AUTO";
}

export function PriceAlignmentCard({
  token,
  cexPrice,
  dexQuotes,
  onExecute,
  executionMode,
}: PriceAlignmentCardProps) {
  const config: TokenConfig = TOKEN_CONFIGS[token];
  
  // Get current DEX price from best quote
  const currentDexPrice = useMemo(() => {
    const validQuotes = dexQuotes.filter(q => q.valid);
    if (validQuotes.length === 0) return 0;
    // Use the $100 quote as reference, or first available
    const refQuote = validQuotes.find(q => Math.abs(q.amountInUSDT - 100) < 20) || validQuotes[0];
    return refQuote.executionPrice;
  }, [dexQuotes]);

  // Compute alignment
  const alignment: AlignmentResult = useMemo(() => {
    return computeDexAlignment(cexPrice, currentDexPrice, dexQuotes, config);
  }, [cexPrice, currentDexPrice, dexQuotes, config]);

  const bandStyle = getBandStyle(alignment.bandLevel);
  const isActionRequired = alignment.bandLevel === "ACTION_REQUIRED" || alignment.bandLevel === "WARNING";
  const hasData = alignment.status !== "NO_DATA" && alignment.status !== "INCOMPLETE";

  // Loading state
  if (!hasData) {
    return (
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border border-slate-700 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">{config.displayName}</h2>
          <span className="text-xs px-3 py-1 rounded-full bg-slate-700 text-slate-400">
            WAITING FOR DATA
          </span>
        </div>
        <div className="text-center py-12 text-slate-500">
          <div className="text-4xl mb-3">📡</div>
          <div>Waiting for market data...</div>
          <div className="text-xs mt-2 text-slate-600">
            CEX: {cexPrice > 0 ? "✓" : "..."} | DEX: {currentDexPrice > 0 ? "✓" : "..."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-6 border-2 shadow-xl transition-all ${
      isActionRequired ? "border-red-500/50 shadow-red-500/10" : "border-slate-700"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          {config.displayName}
          <span className="text-xs text-slate-500 font-normal">via {config.cexSource}</span>
        </h2>
        <span className={`text-xs px-3 py-1 rounded-full border font-bold ${bandStyle.bg} ${bandStyle.border} ${bandStyle.text}`}>
          {alignment.bandLevel.replace("_", " ")}
        </span>
      </div>

      {/* Price Comparison - Always Visible */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-slate-900/50 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">CEX Reference ({config.cexSource})</div>
          <div className="font-mono text-2xl text-white">${formatPrice(alignment.cexReferencePrice)}</div>
        </div>
        <div className="bg-slate-900/50 rounded-xl p-4">
          <div className="text-xs text-slate-500 mb-1">DEX Current (Uniswap)</div>
          <div className={`font-mono text-2xl ${bandStyle.text}`}>${formatPrice(alignment.currentDexPrice)}</div>
        </div>
      </div>

      {/* Deviation Display */}
      <div className="mb-6 p-4 rounded-xl bg-slate-900/30">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-slate-400">Price Deviation</span>
          <span className={`font-mono text-xl font-bold ${bandStyle.text}`}>
            {formatDeviation(alignment.deviationPercent)}
          </span>
        </div>
        
        {/* Visual Band Indicator */}
        <div className="relative h-3 bg-slate-700 rounded-full overflow-hidden">
          {/* Ideal zone (center) */}
          <div 
            className="absolute h-full bg-emerald-500/40"
            style={{ left: "45%", width: "10%" }}
          />
          {/* Acceptable zone */}
          <div 
            className="absolute h-full bg-blue-500/30"
            style={{ left: "35%", width: "10%" }}
          />
          <div 
            className="absolute h-full bg-blue-500/30"
            style={{ left: "55%", width: "10%" }}
          />
          {/* Warning zone */}
          <div 
            className="absolute h-full bg-yellow-500/20"
            style={{ left: "20%", width: "15%" }}
          />
          <div 
            className="absolute h-full bg-yellow-500/20"
            style={{ left: "65%", width: "15%" }}
          />
          {/* Current position marker */}
          <div
            className="absolute w-1.5 h-full bg-white rounded shadow-lg shadow-white/50"
            style={{
              left: `${Math.min(Math.max(50 + alignment.deviationPercent * 10, 5), 95)}%`,
              transform: "translateX(-50%)",
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 mt-1 font-mono">
          <span>-5%</span>
          <span>Aligned</span>
          <span>+5%</span>
        </div>
      </div>

      {/* RECOMMENDED ACTION - The Core Answer */}
      {alignment.direction !== "ALIGNED" ? (
        <div className={`p-5 rounded-xl border-2 ${bandStyle.bg} ${bandStyle.border}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-2xl">⚡</span>
              <span className="text-lg font-bold text-white">Recommended Action</span>
            </div>
            <span className={`px-4 py-2 rounded-lg font-bold text-white ${
              alignment.direction === "BUY_ON_DEX" ? "bg-emerald-600" : "bg-red-600"
            }`}>
              {alignment.direction === "BUY_ON_DEX" ? "BUY" : "SELL"} on Uniswap
            </span>
          </div>

          {/* THE CORE ANSWER - Token Amount */}
          <div className="bg-slate-900/70 rounded-xl p-4 mb-4">
            <div className="text-xs text-slate-400 mb-2">Required Trade Size</div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-mono font-bold text-white">
                {formatTokenAmount(alignment.tokenAmount, token)}
              </span>
              <span className="text-lg font-mono text-slate-400">
                ≈ ${alignment.usdtAmount.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Expected Outcome */}
          <div className="grid grid-cols-3 gap-3 text-sm mb-4">
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">Expected Price</div>
              <div className="font-mono text-emerald-400">${formatPrice(alignment.expectedDexPrice)}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">Gas Cost</div>
              <div className="font-mono text-slate-300">~${alignment.gasCostUsdt.toFixed(2)}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">Slippage</div>
              <div className="font-mono text-slate-300">~{alignment.slippagePercent.toFixed(2)}%</div>
            </div>
          </div>

          {/* Confidence & Execute Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded ${
                alignment.confidence === "HIGH" ? "bg-emerald-500/20 text-emerald-400" :
                alignment.confidence === "MEDIUM" ? "bg-yellow-500/20 text-yellow-400" :
                "bg-red-500/20 text-red-400"
              }`}>
                {alignment.confidence} CONFIDENCE
              </span>
              <span className="text-slate-500">
                Source: UI Scrape
              </span>
            </div>
            
            {executionMode === "MANUAL" && onExecute && (
              <button
                onClick={() => onExecute(alignment.direction, alignment.tokenAmount)}
                className={`px-6 py-2 rounded-lg font-bold text-white transition-all hover:scale-105 ${
                  alignment.direction === "BUY_ON_DEX" 
                    ? "bg-emerald-600 hover:bg-emerald-500" 
                    : "bg-red-600 hover:bg-red-500"
                }`}
              >
                Execute Trade →
              </button>
            )}
          </div>
        </div>
      ) : (
        /* ALIGNED STATE */
        <div className="p-5 rounded-xl bg-emerald-500/10 border-2 border-emerald-500/30">
          <div className="flex items-center gap-3">
            <span className="text-3xl">✓</span>
            <div>
              <div className="text-lg font-bold text-emerald-400">Prices Aligned</div>
              <div className="text-sm text-emerald-400/70">
                DEX price is within ±{config.bands.ideal}% of CEX reference
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Status Bar */}
      <div className="mt-4 pt-4 border-t border-slate-700/50 flex items-center justify-between text-xs text-slate-500">
        <div className="flex items-center gap-3">
          <span>Mode: {executionMode}</span>
          <span>•</span>
          <span>Bands: ±{config.bands.ideal}% / ±{config.bands.acceptable}%</span>
        </div>
        <span>
          Updated {new Date(alignment.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}
