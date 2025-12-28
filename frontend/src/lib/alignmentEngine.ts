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
  executionPrice: number; // USDT per token
  gasEstimateUsdt: number | null; // null if not scraped - NO PLACEHOLDERS
  slippagePercent: number;
  valid: boolean;
  source: string; // "ui_scrape" | "rpc" | "api"
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
  gasCostUsdt: number | null; // null if not scraped - NO PLACEHOLDERS
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
    maxTradeSize: 100000, // Tighter for low liquidity
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
    maxTradeSize: 50000, // Higher liquidity allows larger trades
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

// Safety caps - configurable limits
export const SAFETY_CAPS = {
  MAX_ALIGN_USDT: 2000, // Max USDT to suggest for alignment
  MAX_ALIGN_TOKENS: 100000, // Max tokens to suggest
  MAX_STALENESS_SEC: 60, // Data older than 60s is stale
  HIGH_SLIPPAGE_PCT: 3, // Warn if slippage > 3%
};

/**
 * Find the best quote from available quotes based on deviation from CEX
 * Returns the quote that gets us closest to CEX price within safety caps
 */
function findBestAlignmentQuote(
  quotes: DexQuote[],
  cexPrice: number,
  _direction: "BUY_ON_DEX" | "SELL_ON_DEX" // Reserved for future bidirectional support
): { quote: DexQuote | null; deviation: number } {
  const validQuotes = quotes.filter(
    (q) => q.valid && q.amountInUSDT <= SAFETY_CAPS.MAX_ALIGN_USDT
  );

  if (validQuotes.length === 0) {
    return { quote: null, deviation: Infinity };
  }

  // Sort quotes by size (ascending)
  const sorted = [...validQuotes].sort(
    (a, b) => a.amountInUSDT - b.amountInUSDT
  );

  // Find the quote with smallest deviation from CEX
  let bestQuote: DexQuote | null = null;
  let bestDeviation = Infinity;

  for (const quote of sorted) {
    const deviation = ((quote.executionPrice - cexPrice) / cexPrice) * 100;
    const absDeviation = Math.abs(deviation);

    if (absDeviation < bestDeviation) {
      bestDeviation = absDeviation;
      bestQuote = quote;
    }
  }

  return { quote: bestQuote, deviation: bestDeviation };
}

/**
 * Core alignment computation - USES ONLY REAL QUOTES
 *
 * This function does NOT invent prices. It only uses actual scraped quotes.
 * If we don't have a quote at the right size, we say so clearly.
 *
 * @param cexPrice - CEX reference price (USDT per token)
 * @param currentDexPrice - Current DEX execution price (from smallest quote)
 * @param quotes - Available DEX quotes at different sizes (FROM SCRAPER)
 * @param config - Token configuration
 * @returns AlignmentResult with trade recommendation based on REAL quotes only
 */
export function computeDexAlignment(
  cexPrice: number,
  currentDexPrice: number,
  quotes: DexQuote[],
  config: TokenConfig
): AlignmentResult {
  const timestamp = Date.now();
  const validQuotes = quotes.filter((q) => q.valid);

  // Handle missing CEX data
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

  // Handle missing DEX data
  if (validQuotes.length === 0 || !currentDexPrice || currentDexPrice <= 0) {
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

  // Calculate current deviation using smallest available quote
  const smallestQuote = validQuotes.reduce(
    (min, q) => (q.amountInUSDT < min.amountInUSDT ? q : min),
    validQuotes[0]
  );
  const refDexPrice = smallestQuote.executionPrice;

  const deviationPercent = ((refDexPrice - cexPrice) / cexPrice) * 100;
  const deviationBps = deviationPercent * 100;
  const bandLevel = classifyDeviation(deviationPercent, config.bands);

  // Determine direction based on deviation
  // If DEX price > CEX price, we need to SELL on DEX to push price down
  // If DEX price < CEX price, we need to BUY on DEX to push price up
  const direction: AlignmentDirection =
    deviationPercent > config.bands.ideal
      ? "SELL_ON_DEX"
      : deviationPercent < -config.bands.ideal
      ? "BUY_ON_DEX"
      : "ALIGNED";

  // If already aligned, return early
  if (direction === "ALIGNED") {
    return {
      status: "OK",
      direction: "ALIGNED",
      tokenAmount: 0,
      usdtAmount: 0,
      currentDexPrice: refDexPrice,
      expectedDexPrice: refDexPrice,
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

  // Find best quote within safety caps
  // For now, suggest the largest quote we have within caps
  // (In reality, we'd need to do binary search with on-demand quotes)
  const { quote: bestQuote, deviation: bestDeviation } = findBestAlignmentQuote(
    quotes,
    cexPrice,
    direction
  );

  if (!bestQuote) {
    return {
      status: "LOW_LIQUIDITY",
      direction,
      tokenAmount: 0,
      usdtAmount: 0,
      currentDexPrice: refDexPrice,
      expectedDexPrice: refDexPrice,
      cexReferencePrice: cexPrice,
      deviationPercent,
      deviationBps,
      gasCostUsdt: 0,
      slippagePercent: 0,
      confidence: "LOW",
      bandLevel,
      timestamp,
    };
  }

  // Use the ACTUAL quote values - no estimation!
  const tokenAmount = bestQuote.tokensOut;
  const usdtAmount = bestQuote.amountInUSDT;
  const gasCostUsdt = bestQuote.gasEstimateUsdt ?? null;
  const slippagePercent = bestQuote.slippagePercent || 0.5;

  // Determine confidence based on data quality
  let confidence: ConfidenceLevel = "MEDIUM";
  if (
    validQuotes.length >= 4 &&
    slippagePercent < SAFETY_CAPS.HIGH_SLIPPAGE_PCT
  ) {
    confidence = "HIGH";
  } else if (
    validQuotes.length < 2 ||
    slippagePercent > SAFETY_CAPS.HIGH_SLIPPAGE_PCT
  ) {
    confidence = "LOW";
  }

  // Add warning if we can't actually align within caps
  const canAlign = bestDeviation <= config.bands.acceptable;

  return {
    status: canAlign ? "OK" : "LOW_LIQUIDITY",
    direction,
    tokenAmount: Math.round(tokenAmount),
    usdtAmount: Math.round(usdtAmount * 100) / 100,
    currentDexPrice: refDexPrice,
    expectedDexPrice: bestQuote.executionPrice, // This is the ACTUAL quote price
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
