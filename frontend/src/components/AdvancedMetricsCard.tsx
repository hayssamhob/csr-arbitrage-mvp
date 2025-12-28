/**
 * AdvancedMetricsCard - Collapsed by Default
 * 
 * Contains secondary metrics that are hidden under "Advanced":
 * - Raw spread in bps
 * - Arbitrage profit calculations
 * - Edge after costs
 * - Spread history
 * - Transaction history
 */

import { useState } from "react";

interface SpreadHistoryPoint {
  timestamp: number;
  spreadBps: number;
}

interface TransactionRecord {
  timestamp: string;
  direction: string;
  tokenAmount: number;
  usdtAmount: number;
  status: "executed" | "dry_run" | "failed";
}

interface AdvancedMetricsCardProps {
  token: "CSR" | "CSR25";
  cexPrice: number;
  dexPrice: number;
  spreadHistory: SpreadHistoryPoint[];
  transactions: TransactionRecord[];
  defaultExpanded?: boolean;
}

export function AdvancedMetricsCard({
  token,
  cexPrice,
  dexPrice,
  spreadHistory,
  transactions,
  defaultExpanded = false,
}: AdvancedMetricsCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Calculate spread metrics
  const rawSpreadBps =
    cexPrice > 0 && dexPrice > 0
      ? ((dexPrice - cexPrice) / cexPrice) * 10000
      : 0;

  // Hypothetical arbitrage calculation (on $1000 trade)
  const hypotheticalSize = 1000;
  const dexFeeBps = 30; // 0.3% Uniswap fee
  const cexFeeBps = 20; // Typical CEX fee
  const gasUsdt = 0; // Gas not available - do not show placeholder
  const slippageBps = 10;

  const totalCostBps =
    dexFeeBps + cexFeeBps + slippageBps + (gasUsdt / hypotheticalSize) * 10000;
  const edgeAfterCostsBps = Math.abs(rawSpreadBps) - totalCostBps;
  const grossProfitUsdt = (Math.abs(rawSpreadBps) / 10000) * hypotheticalSize;
  const netProfitUsdt = (edgeAfterCostsBps / 10000) * hypotheticalSize;

  return (
    <div className="bg-slate-800/30 rounded-xl border border-slate-700/50">
      {/* Header - Always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-700/20 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-slate-500">📈</span>
          <span className="text-sm font-medium text-slate-400">
            Advanced Metrics - {token}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-600">
            (Spread, Arbitrage, History)
          </span>
          <span
            className={`text-slate-500 transition-transform ${
              isExpanded ? "rotate-180" : ""
            }`}
          >
            ▼
          </span>
        </div>
      </button>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-2 border-t border-slate-700/30 space-y-4">
          {/* Raw Spread Metrics */}
          <div className="bg-slate-900/30 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-2">
              Raw Spread Analysis
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Raw Spread</span>
                <span
                  className={`font-mono ${
                    rawSpreadBps >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {rawSpreadBps >= 0 ? "+" : ""}
                  {rawSpreadBps.toFixed(0)} bps
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Costs</span>
                <span className="font-mono text-yellow-400">
                  {totalCostBps.toFixed(0)} bps
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Edge After Costs</span>
                <span
                  className={`font-mono ${
                    edgeAfterCostsBps >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {edgeAfterCostsBps >= 0 ? "+" : ""}
                  {edgeAfterCostsBps.toFixed(0)} bps
                </span>
              </div>
            </div>
          </div>

          {/* Hypothetical Arbitrage */}
          <div className="bg-slate-900/30 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-2">
              Hypothetical Arbitrage (${hypotheticalSize} trade)
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Gross Profit</span>
                <span className="font-mono text-slate-300">
                  ${grossProfitUsdt.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Net Profit</span>
                <span
                  className={`font-mono ${
                    netProfitUsdt >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  ${netProfitUsdt.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-600">
              ⚠️ These are estimates. Actual results depend on liquidity and
              timing.
            </div>
          </div>

          {/* Spread History Mini-Chart */}
          <div className="bg-slate-900/30 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-2">
              Spread History (Last 20)
            </div>
            {spreadHistory.length > 0 ? (
              <div className="h-16 flex items-end gap-0.5">
                {spreadHistory.slice(-20).map((point, i) => {
                  const maxSpread = Math.max(
                    ...spreadHistory.map((p) => Math.abs(p.spreadBps)),
                    100
                  );
                  const height = (Math.abs(point.spreadBps) / maxSpread) * 100;
                  return (
                    <div
                      key={i}
                      className={`flex-1 rounded-t ${
                        point.spreadBps >= 0
                          ? "bg-emerald-500/50"
                          : "bg-red-500/50"
                      }`}
                      style={{ height: `${Math.max(height, 5)}%` }}
                      title={`${point.spreadBps.toFixed(0)} bps`}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-4 text-slate-600 text-xs">
                No spread history available
              </div>
            )}
          </div>

          {/* Recent Transactions */}
          <div className="bg-slate-900/30 rounded-lg p-3">
            <div className="text-xs text-slate-500 mb-2">
              Recent Transactions
            </div>
            {transactions.length > 0 ? (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {transactions.slice(-5).map((tx, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-xs py-1 border-b border-slate-700/30 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          tx.direction === "BUY"
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {tx.direction}
                      </span>
                      <span className="text-slate-400 font-mono">
                        {tx.tokenAmount.toLocaleString()} {token}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">
                        ${tx.usdtAmount.toFixed(2)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] ${
                          tx.status === "executed"
                            ? "bg-emerald-500/20 text-emerald-400"
                            : tx.status === "dry_run"
                            ? "bg-yellow-500/20 text-yellow-400"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {tx.status.toUpperCase()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-slate-600 text-xs">
                No transactions yet
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
