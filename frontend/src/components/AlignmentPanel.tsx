/**
 * DEX Price Alignment Panel
 * 
 * Displays price deviation, band status, and alignment suggestions
 * for maintaining DEX price aligned with CEX price.
 */

import { useMemo } from "react";

// Types (inline to avoid import issues)
type BandStatus = "neutral" | "soft" | "hard";
type AlignmentDirection = "buy_dex" | "sell_dex" | "none";

interface AlignmentBands {
  neutralPercent: number;
  softPercent: number;
  hardPercent: number;
  alignmentMargin: number;
}

interface AlignmentConfig {
  bands: AlignmentBands;
  maxTradeSizeUsdt: number;
  cooldownSeconds: number;
  minBenefitBps: number;
  mode: "off" | "paper" | "live";
}

interface QuoteEntry {
  amountInUSDT: number;
  price_usdt_per_token: number;
  price_token_per_usdt: number;
  valid: boolean;
  gasEstimateUsdt: number | null;
}

interface AlignmentPanelProps {
  market: string;
  cexPrice: number;
  cexSource: string;
  quotes: QuoteEntry[];
  config?: AlignmentConfig;
  onConfigChange?: (config: AlignmentConfig) => void;
}

const DEFAULT_CONFIG: AlignmentConfig = {
  bands: {
    neutralPercent: 0.5,
    softPercent: 1.5,
    hardPercent: 2.0,
    alignmentMargin: 0.2,
  },
  maxTradeSizeUsdt: 500,
  cooldownSeconds: 120,
  minBenefitBps: 10,
  mode: "off",
};

function classifyBand(
  deviationPercent: number,
  bands: AlignmentBands
): BandStatus {
  const absDeviation = Math.abs(deviationPercent);
  if (absDeviation <= bands.neutralPercent) return "neutral";
  if (absDeviation <= bands.softPercent) return "soft";
  return "hard";
}

function getBandColor(band: BandStatus): string {
  switch (band) {
    case "neutral":
      return "text-emerald-400";
    case "soft":
      return "text-yellow-400";
    case "hard":
      return "text-red-400";
  }
}

function getBandBgColor(band: BandStatus): string {
  switch (band) {
    case "neutral":
      return "bg-emerald-500/20 border-emerald-500/50";
    case "soft":
      return "bg-yellow-500/20 border-yellow-500/50";
    case "hard":
      return "bg-red-500/20 border-red-500/50";
  }
}

export function AlignmentPanel({
  market,
  cexPrice,
  cexSource,
  quotes,
  config = DEFAULT_CONFIG,
}: AlignmentPanelProps) {
  // Use market in title
  const marketTitle = market.replace("_", "/");

  // Get best reference quote (closest to $100 or first available)
  const referenceQuote = useMemo(() => {
    const valid = quotes.filter((q) => q.valid);
    if (valid.length === 0) return null;
    // Prefer quote closest to $100, otherwise first
    return valid.find((q) => Math.abs(q.amountInUSDT - 100) < 10) || valid[0];
  }, [quotes]);

  // DEX price from reference quote
  const dexPrice = referenceQuote?.price_usdt_per_token || 0;

  // Check if data is ready
  const isDataReady = cexPrice > 0 && dexPrice > 0;

  // Price deviation
  const deviationPercent = isDataReady
    ? ((dexPrice - cexPrice) / cexPrice) * 100
    : 0;
  const deviationBps = deviationPercent * 100;

  // Band classification
  const bandStatus = classifyBand(deviationPercent, config.bands);

  // Suggested action
  const direction: AlignmentDirection =
    bandStatus === "neutral"
      ? "none"
      : deviationPercent > 0
      ? "sell_dex"
      : "buy_dex";

  // Estimate trade size (simplified)
  const suggestedSizeUsdt = Math.min(
    Math.abs(deviationPercent) * 100, // Rough heuristic
    config.maxTradeSizeUsdt
  );
  const suggestedSizeTokens = dexPrice > 0 ? suggestedSizeUsdt / dexPrice : 0;

  // Estimate costs
  const gasUsdt = selectedQuote?.gasEstimateUsdt || 2; // Default $2 gas
  const dexFeeBps = 30; // 0.3% Uniswap fee
  const slippageBps = Math.min(suggestedSizeUsdt / 100, 50);
  const totalCostBps =
    dexFeeBps + slippageBps + (gasUsdt / suggestedSizeUsdt) * 10000;

  // Estimate benefit
  const gapReductionBps = Math.abs(deviationBps) * 0.5; // Assume 50% reduction
  const netBenefitBps = gapReductionBps - totalCostBps;
  const isEconomical = netBenefitBps >= config.minBenefitBps;

  // Format price
  const formatPrice = (price: number) => {
    if (price < 0.01) return price.toFixed(6);
    if (price < 1) return price.toFixed(4);
    return price.toFixed(2);
  };

  if (!isDataReady) {
    return (
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700 opacity-70">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-semibold text-slate-300">
            {marketTitle} Alignment
          </h4>
          <span className="text-xs px-2 py-0.5 rounded border border-slate-600 text-slate-500">
            WAITING
          </span>
        </div>
        <div className="text-center py-8 text-slate-500 text-sm">
          Waiting for market data...
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-slate-300">
          {marketTitle} Alignment
        </h4>
        <span
          className={`text-xs px-2 py-0.5 rounded border ${getBandBgColor(
            bandStatus
          )}`}
        >
          {bandStatus.toUpperCase()}
        </span>
      </div>

      {/* Price Comparison */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-slate-900/30 p-2 rounded">
          <div className="text-xs text-slate-500 mb-1">CEX ({cexSource})</div>
          <div className="font-mono text-lg text-slate-200">
            ${formatPrice(cexPrice)}
          </div>
        </div>
        <div className="bg-slate-900/30 p-2 rounded">
          <div className="text-xs text-slate-500 mb-1">DEX (Uniswap)</div>
          <div className="font-mono text-lg text-blue-400">
            ${formatPrice(dexPrice)}
          </div>
        </div>
      </div>

      {/* Deviation */}
      <div className="mb-4 p-3 rounded bg-slate-900/50">
        <div className="flex justify-between items-center mb-2">
          <span className="text-sm text-slate-400">Price Deviation</span>
          <span
            className={`font-mono text-lg font-bold ${getBandColor(
              bandStatus
            )}`}
          >
            {deviationPercent > 0 ? "+" : ""}
            {deviationPercent.toFixed(2)}%
          </span>
        </div>

        {/* Band Indicator */}
        <div className="relative h-2 bg-slate-700 rounded overflow-hidden mb-1">
          {/* Neutral Band (Green) */}
          <div
            className="absolute h-full bg-emerald-500/50"
            style={{
              left: `${50 - config.bands.neutralPercent * 10}%`,
              width: `${config.bands.neutralPercent * 20}%`,
            }}
          />
          {/* Soft Band (Yellow) - Left */}
          <div
            className="absolute h-full bg-yellow-500/30"
            style={{
              left: `${50 - config.bands.softPercent * 10}%`,
              width: `${
                (config.bands.softPercent - config.bands.neutralPercent) * 10
              }%`,
            }}
          />
          {/* Soft Band (Yellow) - Right */}
          <div
            className="absolute h-full bg-yellow-500/30"
            style={{
              left: `${50 + config.bands.neutralPercent * 10}%`,
              width: `${
                (config.bands.softPercent - config.bands.neutralPercent) * 10
              }%`,
            }}
          />
          {/* Current position marker */}
          <div
            className="absolute w-1 h-full bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]"
            style={{
              left: `${Math.min(
                Math.max(50 + deviationPercent * 10, 0),
                100
              )}%`,
              transform: "translateX(-50%)",
            }}
          />
        </div>
        <div className="flex justify-between text-[10px] text-slate-500 font-mono">
          <span>-{config.bands.softPercent}%</span>
          <span>Aligned</span>
          <span>+{config.bands.softPercent}%</span>
        </div>
      </div>

      {/* Required Action / Restore Balance */}
      {bandStatus !== "neutral" && (
        <div className={`p-4 rounded border ${getBandBgColor(bandStatus)}`}>
          <div className="flex justify-between items-center mb-3">
            <span className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <span>⚖️</span> Restore Balance
            </span>
            <span
              className={`text-xs px-2 py-1 rounded font-bold ${
                direction === "buy_dex" ? "bg-emerald-600" : "bg-red-600"
              } text-white`}
            >
              {direction === "buy_dex" ? "BUY DEX" : "SELL DEX"}
            </span>
          </div>

          <div className="bg-slate-900/50 rounded p-3 mb-3">
            <div className="text-xs text-slate-400 mb-1">
              Estimated Amount to Restore
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-xl font-mono font-bold text-white">
                {suggestedSizeTokens.toFixed(2)} Tokens
              </span>
              <span className="text-sm font-mono text-slate-400">
                (~${suggestedSizeUsdt.toFixed(0)})
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-400">
            <div>
              Est. Cost:{" "}
              <span className="text-slate-300 font-mono">
                {totalCostBps.toFixed(0)} bps
              </span>
            </div>
            <div>
              Net Benefit:{" "}
              <span
                className={`font-mono ${
                  netBenefitBps >= 0 ? "text-emerald-400" : "text-red-400"
                }`}
              >
                {netBenefitBps.toFixed(0)} bps
              </span>
            </div>
          </div>

          {!isEconomical && (
            <div className="mt-3 pt-2 border-t border-white/10 text-xs text-yellow-400 flex items-center gap-1">
              <span>⚠️</span> Small mispricing - trade may not be profitable
            </div>
          )}
        </div>
      )}

      {bandStatus === "neutral" && (
        <div className="p-4 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2">
          <span className="text-lg">✓</span>
          <div>
            <div className="font-bold">Prices Aligned</div>
            <div className="text-emerald-400/70 text-xs">No action needed</div>
          </div>
        </div>
      )}
    </div>
  );
}
