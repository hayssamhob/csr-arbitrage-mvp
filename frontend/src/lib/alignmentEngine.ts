/**
 * DEX Price Alignment Engine
 * 
 * Computes the exact token amount needed to realign DEX price with CEX reference.
 * Uses binary search to find the optimal trade size.
 */

export type AlignmentDirection = "BUY_ON_DEX" | "SELL_ON_DEX" | "ALIGNED";
export type AlignmentStatus = "OK" | "LOW_LIQUIDITY" | "INCOMPLETE" | "NO_DATA";
export type ConfidenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface AlignmentBands {
  ideal: number;      // ±0.25% - Ideal range
  acceptable: number; // ±0.5% - Acceptable
  warning: number;    // ±1.0% - Warning
  action: number;     // >1.0% - Action Required
}

export interface TokenConfig {
  symbol: string;
  displayName: string;
  cexSource: string;
  bands: AlignmentBands;
  maxTradeSize: number;      // Max tokens per trade
  minTokenStep: number;      // Minimum token increment for binary search
  decimals: number;
}

export interface DexQuote {
  amountInUSDT: number;
  tokensOut: number;
  executionPrice: number;    // USDT per token
  gasEstimateUsdt: number;
  slippagePercent: number;
  valid: boolean;
  source: string;            // "ui_scrape" | "rpc" | "api"
}

export interface AlignmentResult {
  status: AlignmentStatus;
  direction: AlignmentDirection;
  tokenAmount: number;
  usdtAmount: number;
  currentDexPrice: number;
  expectedDexPrice: number;
  cexReferencePrice: number;
  deviationPercent: number;
  deviationBps: number;
  gasCostUsdt: number;
  slippagePercent: number;
  confidence: ConfidenceLevel;
  bandLevel: "IDEAL" | "ACCEPTABLE" | "WARNING" | "ACTION_REQUIRED";
  timestamp: number;
}

// Default alignment bands per token
export const TOKEN_CONFIGS: Record<string, TokenConfig> = {
  CSR: {
    symbol: "CSR",
    displayName: "CSR / USDT",
    cexSource: "LATOKEN",
    bands: {
      ideal: 0.25,
      acceptable: 0.5,
      warning: 1.0,
      action: 1.5,
    },
    maxTradeSize: 100000,   // Tighter for low liquidity
    minTokenStep: 100,
    decimals: 18,
  },
  CSR25: {
    symbol: "CSR25",
    displayName: "CSR25 / USDT",
    cexSource: "LBANK",
    bands: {
      ideal: 0.5,
      acceptable: 1.0,
      warning: 1.5,
      action: 2.0,
    },
    maxTradeSize: 50000,    // Higher liquidity allows larger trades
    minTokenStep: 10,
    decimals: 18,
  },
};

/**
 * Classify deviation into band level
 */
export function classifyDeviation(
  deviationPercent: number,
  bands: AlignmentBands
): "IDEAL" | "ACCEPTABLE" | "WARNING" | "ACTION_REQUIRED" {
  const abs = Math.abs(deviationPercent);
  if (abs <= bands.ideal) return "IDEAL";
  if (abs <= bands.acceptable) return "ACCEPTABLE";
  if (abs <= bands.warning) return "WARNING";
  return "ACTION_REQUIRED";
}

/**
 * Get band color for UI
 */
export function getBandStyle(band: ReturnType<typeof classifyDeviation>): {
  text: string;
  bg: string;
  border: string;
} {
  switch (band) {
    case "IDEAL":
      return {
        text: "text-emerald-400",
        bg: "bg-emerald-500/20",
        border: "border-emerald-500/50",
      };
    case "ACCEPTABLE":
      return {
        text: "text-blue-400",
        bg: "bg-blue-500/20",
        border: "border-blue-500/50",
      };
    case "WARNING":
      return {
        text: "text-yellow-400",
        bg: "bg-yellow-500/20",
        border: "border-yellow-500/50",
      };
    case "ACTION_REQUIRED":
      return {
        text: "text-red-400",
        bg: "bg-red-500/20",
        border: "border-red-500/50",
      };
  }
}

/**
 * Estimate post-trade DEX price based on trade size and direction
 * This is a simplified model - real implementation would use AMM math
 */
function estimatePostTradePrice(
  currentPrice: number,
  tradeTokens: number,
  direction: "BUY_ON_DEX" | "SELL_ON_DEX",
  poolLiquidity: number = 100000 // Estimated pool liquidity in tokens
): number {
  // Simplified constant product AMM model
  // Price impact ≈ tradeSize / (2 * liquidity)
  const priceImpact = tradeTokens / (2 * poolLiquidity);
  
  if (direction === "BUY_ON_DEX") {
    // Buying pushes price up
    return currentPrice * (1 + priceImpact);
  } else {
    // Selling pushes price down
    return currentPrice * (1 - priceImpact);
  }
}

/**
 * Core alignment computation using binary search
 * 
 * @param cexPrice - CEX reference price (USDT per token)
 * @param currentDexPrice - Current DEX execution price
 * @param quotes - Available DEX quotes at different sizes
 * @param config - Token configuration
 * @returns AlignmentResult with exact trade recommendation
 */
export function computeDexAlignment(
  cexPrice: number,
  currentDexPrice: number,
  quotes: DexQuote[],
  config: TokenConfig
): AlignmentResult {
  const timestamp = Date.now();
  
  // Handle missing data
  if (!cexPrice || cexPrice <= 0) {
    return {
      status: "NO_DATA",
      direction: "ALIGNED",
      tokenAmount: 0,
      usdtAmount: 0,
      currentDexPrice: 0,
      expectedDexPrice: 0,
      cexReferencePrice: 0,
      deviationPercent: 0,
      deviationBps: 0,
      gasCostUsdt: 0,
      slippagePercent: 0,
      confidence: "LOW",
      bandLevel: "IDEAL",
      timestamp,
    };
  }
  
  if (!currentDexPrice || currentDexPrice <= 0) {
    return {
      status: "INCOMPLETE",
      direction: "ALIGNED",
      tokenAmount: 0,
      usdtAmount: 0,
      currentDexPrice: 0,
      expectedDexPrice: 0,
      cexReferencePrice: cexPrice,
      deviationPercent: 0,
      deviationBps: 0,
      gasCostUsdt: 0,
      slippagePercent: 0,
      confidence: "LOW",
      bandLevel: "IDEAL",
      timestamp,
    };
  }

  // Calculate current deviation
  const deviationPercent = ((currentDexPrice - cexPrice) / cexPrice) * 100;
  const deviationBps = deviationPercent * 100;
  const bandLevel = classifyDeviation(deviationPercent, config.bands);
  
  // Determine direction
  const direction: AlignmentDirection = 
    deviationPercent > config.bands.ideal ? "SELL_ON_DEX" :
    deviationPercent < -config.bands.ideal ? "BUY_ON_DEX" :
    "ALIGNED";
  
  // If already aligned, return early
  if (direction === "ALIGNED") {
    return {
      status: "OK",
      direction: "ALIGNED",
      tokenAmount: 0,
      usdtAmount: 0,
      currentDexPrice,
      expectedDexPrice: currentDexPrice,
      cexReferencePrice: cexPrice,
      deviationPercent,
      deviationBps,
      gasCostUsdt: 0,
      slippagePercent: 0,
      confidence: "HIGH",
      bandLevel,
      timestamp,
    };
  }

  // Binary search for optimal trade size
  const targetBandPercent = config.bands.ideal;
  let low = 0;
  let high = config.maxTradeSize;
  let bestSize: number | null = null;
  let bestExpectedPrice = currentDexPrice;
  
  // Estimate pool liquidity from quotes
  const validQuotes = quotes.filter(q => q.valid);
  const poolLiquidity = validQuotes.length > 0 
    ? Math.max(...validQuotes.map(q => q.tokensOut)) * 10 
    : 100000;

  const iterations = 20; // Max binary search iterations
  for (let i = 0; i < iterations && (high - low) > config.minTokenStep; i++) {
    const mid = (low + high) / 2;
    
    // Estimate new DEX price after trade
    const newDexPrice = estimatePostTradePrice(
      currentDexPrice,
      mid,
      direction as "BUY_ON_DEX" | "SELL_ON_DEX",
      poolLiquidity
    );
    
    const newDeviationPercent = ((newDexPrice - cexPrice) / cexPrice) * 100;
    const absDeviation = Math.abs(newDeviationPercent);
    
    if (absDeviation <= targetBandPercent) {
      // Found a valid size, try to find smaller
      bestSize = mid;
      bestExpectedPrice = newDexPrice;
      high = mid;
    } else {
      // Need larger trade
      low = mid;
    }
  }

  // If no size found within limits
  if (bestSize === null) {
    // Use max trade size as fallback
    bestSize = config.maxTradeSize;
    bestExpectedPrice = estimatePostTradePrice(
      currentDexPrice,
      bestSize,
      direction as "BUY_ON_DEX" | "SELL_ON_DEX",
      poolLiquidity
    );
  }

  // Calculate costs
  const usdtAmount = bestSize * currentDexPrice;
  const gasCostUsdt = validQuotes[0]?.gasEstimateUsdt || 2.5;
  const slippagePercent = Math.min((bestSize / poolLiquidity) * 100, 5);
  
  // Determine confidence
  let confidence: ConfidenceLevel = "HIGH";
  if (validQuotes.length === 0) {
    confidence = "LOW";
  } else if (validQuotes.length < 3 || slippagePercent > 2) {
    confidence = "MEDIUM";
  }

  return {
    status: validQuotes.length > 0 ? "OK" : "LOW_LIQUIDITY",
    direction,
    tokenAmount: Math.round(bestSize),
    usdtAmount: Math.round(usdtAmount * 100) / 100,
    currentDexPrice,
    expectedDexPrice: bestExpectedPrice,
    cexReferencePrice: cexPrice,
    deviationPercent,
    deviationBps,
    gasCostUsdt,
    slippagePercent,
    confidence,
    bandLevel,
    timestamp,
  };
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: number, symbol: string): string {
  if (amount >= 1000000) {
    return `${(amount / 1000000).toFixed(2)}M ${symbol}`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(2)}K ${symbol}`;
  }
  return `${amount.toFixed(2)} ${symbol}`;
}

/**
 * Format price for display (handles very small prices)
 */
export function formatPrice(price: number): string {
  if (!price || price <= 0) return "—";
  if (price < 0.0001) return price.toFixed(8);
  if (price < 0.01) return price.toFixed(6);
  if (price < 1) return price.toFixed(4);
  return price.toFixed(2);
}

/**
 * Format deviation for display
 */
export function formatDeviation(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}
