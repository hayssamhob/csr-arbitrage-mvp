/**
 * MarketContextCard - Secondary UI Component (Collapsed by Default)
 * 
 * Shows detailed market context:
 * - CEX Snapshot (Bid/Ask/Mid, Volume, Source)
 * - DEX Snapshot (Execution price, Gas, Slippage)
 */

import { useState } from "react";
import { formatPrice } from "../lib/alignmentEngine";

interface CexData {
  bid: number;
  ask: number;
  last: number;
  volume24h: number;
  source: string;
  timestamp: string;
}

interface DexData {
  executionPrice: number;
  gasEstimateUsdt: number | null; // null if not scraped
  quoteSize: number;
  source: string;
  timestamp: string;
}

interface MarketContextCardProps {
  token: "CSR" | "CSR25";
  cexData: CexData | null;
  dexData: DexData | null;
  defaultExpanded?: boolean;
}

export function MarketContextCard({
  token,
  cexData,
  dexData,
  defaultExpanded = false,
}: MarketContextCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const cexMid = cexData ? (cexData.bid + cexData.ask) / 2 : 0;

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-700/30 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-400">📊</span>
          <span className="text-sm font-medium text-slate-300">
            Market Context - {token}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {cexData && (
            <span className="text-xs text-slate-500">
              Mid: ${formatPrice(cexMid)}
            </span>
          )}
          <span
            className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}
          >
            ▼
          </span>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-700/50">
          <div className="grid grid-cols-2 gap-4">
            {/* CEX Snapshot */}
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-2 flex items-center justify-between">
                <span>CEX Snapshot</span>
                {cexData && (
                  <span className="text-emerald-400">{cexData.source}</span>
                )}
              </div>

              {cexData ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Bid</span>
                    <span className="font-mono text-emerald-400">
                      ${formatPrice(cexData.bid)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Ask</span>
                    <span className="font-mono text-red-400">
                      ${formatPrice(cexData.ask)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Last</span>
                    <span className="font-mono text-slate-300">
                      ${formatPrice(cexData.last)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm border-t border-slate-700 pt-2 mt-2">
                    <span className="text-slate-400">Volume 24h</span>
                    <span className="font-mono text-slate-300">
                      {cexData.volume24h.toLocaleString()}
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 text-right">
                    {cexData.timestamp}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-slate-500 text-sm">
                  No CEX data available
                </div>
              )}
            </div>

            {/* DEX Snapshot */}
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-2 flex items-center justify-between">
                <span>DEX Snapshot</span>
                {dexData && (
                  <span className="text-blue-400">{dexData.source}</span>
                )}
              </div>

              {dexData ? (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Exec Price</span>
                    <span className="font-mono text-blue-400">
                      ${formatPrice(dexData.executionPrice)}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Quote Size</span>
                    <span className="font-mono text-slate-300">
                      ${dexData.quoteSize}
                    </span>
                  </div>
                  {dexData.gasEstimateUsdt !== null && (
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-400">Gas Est.</span>
                      <span className="font-mono text-slate-300">
                        ${dexData.gasEstimateUsdt.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="text-xs text-slate-600 text-right">
                    {dexData.timestamp}
                  </div>
                </div>
              ) : (
                <div className="text-center py-4 text-slate-500 text-sm">
                  No DEX data available
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
