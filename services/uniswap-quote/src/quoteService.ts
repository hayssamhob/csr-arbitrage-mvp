import { CurrencyAmount, Percent, Token, TradeType } from '@uniswap/sdk-core';
import { AlphaRouter, SwapType } from '@uniswap/smart-order-router';
import { ethers } from 'ethers';
import { Config, TokenConfig } from './config';
import { CachedQuote, UniswapQuoteResult } from './schemas';

// ============================================================================
// Uniswap Quote Service
// READ-ONLY: No execution, no signing
// Per docs.md: Quotes must reflect effective execution price
// ============================================================================

type LogFn = (level: string, event: string, data?: Record<string, unknown>) => void;

export class QuoteService {
  private provider: ethers.providers.JsonRpcProvider;
  private router: AlphaRouter;
  private tokenIn: Token;
  private tokenOut: Token;
  private chainId: number;
  private slippageTolerance: Percent;
  private cacheTtlMs: number;
  private cache: Map<string, CachedQuote> = new Map();
  private consecutiveFailures = 0;
  private readonly onLog: LogFn;

  constructor(config: Config, onLog: LogFn) {
    this.chainId = config.CHAIN_ID;
    this.cacheTtlMs = config.QUOTE_CACHE_TTL_SECONDS * 1000;
    this.slippageTolerance = new Percent(
      Math.round(config.SLIPPAGE_TOLERANCE_PERCENT * 100),
      10000
    );
    this.onLog = onLog;

    // Initialize provider - REAL ON-CHAIN DATA ONLY
    this.provider = new ethers.providers.JsonRpcProvider(config.RPC_URL);

    // Initialize AlphaRouter
    // Per docs.md: Use Smart Order Router for effective execution price
    this.router = new AlphaRouter({
      chainId: this.chainId,
      provider: this.provider,
    });

    // Initialize tokens from config
    // Per agents.md: token addresses must come from config, not hardcoded
    this.tokenIn = this.createToken(config.TOKEN_IN_CONFIG);
    this.tokenOut = this.createToken(config.TOKEN_OUT_CONFIG);

    this.onLog("info", "uniswap_quote_service_initialized", {
      chainId: this.chainId,
      tokenIn: this.tokenIn.symbol,
      tokenOut: this.tokenOut.symbol,
    });

    this.onLog("info", "quote_service_initialized", {
      chainId: this.chainId,
      tokenIn: config.TOKEN_IN_CONFIG.symbol,
      tokenOut: config.TOKEN_OUT_CONFIG.symbol,
    });
  }

  private createToken(config: TokenConfig): Token {
    return new Token(
      this.chainId,
      config.address,
      config.decimals,
      config.symbol,
      config.symbol
    );
  }

  async getQuote(
    amountUsdt: number,
    direction: "buy" | "sell" = "buy"
  ): Promise<UniswapQuoteResult> {
    const cacheKey = `${direction}-${amountUsdt}`;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      this.onLog("debug", "cache_hit", {
        cacheKey,
        age_ms: Date.now() - cached.cachedAt,
      });
      return { ...cached.quote, is_stale: false };
    }

    try {
      const quote = await this.fetchQuote(amountUsdt, direction);

      // Cache the result
      this.cache.set(cacheKey, {
        quote,
        cachedAt: Date.now(),
      });

      this.consecutiveFailures = 0;
      return quote;
    } catch (error) {
      this.consecutiveFailures++;
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.onLog("error", "quote_fetch_failed", {
        error: errorMsg,
        consecutiveFailures: this.consecutiveFailures,
        amountUsdt,
        direction,
      });

      // Return stale cached data if available
      if (cached) {
        this.onLog("warn", "returning_stale_cache", { cacheKey });
        return { ...cached.quote, is_stale: true };
      }

      // Return error result
      return {
        type: "uniswap.quote",
        pair: `${this.tokenOut.symbol}/${this.tokenIn.symbol}`,
        chain_id: this.chainId,
        ts: new Date().toISOString(),
        amount_in: amountUsdt.toString(),
        amount_in_unit: this.tokenIn.symbol || "USDT",
        amount_out: "0",
        amount_out_unit: this.tokenOut.symbol || "TOKEN",
        effective_price_usdt: 0,
        estimated_gas: 0,
        error: errorMsg,
        is_stale: true,
      };
    }
  }

  private async fetchQuote(
    amountUsdt: number,
    direction: "buy" | "sell"
  ): Promise<UniswapQuoteResult> {
    const now = new Date().toISOString();

    // REAL ON-CHAIN QUOTE ONLY - NO MOCK, NO FALLBACKS

    // Determine input/output based on direction
    // buy = USDT -> token (user wants to buy token with USDT)
    // sell = token -> USDT (user wants to sell token for USDT)
    const inputToken = direction === "buy" ? this.tokenIn : this.tokenOut;
    const outputToken = direction === "buy" ? this.tokenOut : this.tokenIn;

    // Convert amount to wei/smallest unit
    const amountInWei = ethers.utils.parseUnits(
      amountUsdt.toString(),
      inputToken.decimals
    );

    const inputAmount = CurrencyAmount.fromRawAmount(
      inputToken,
      amountInWei.toString()
    );

    this.onLog("debug", "fetching_quote", {
      direction,
      amountUsdt,
      inputToken: inputToken.symbol,
      outputToken: outputToken.symbol,
    });

    // Get route using AlphaRouter
    // Per docs.md: This gives us effective execution price, not spot price
    const route = await this.router.route(
      inputAmount,
      outputToken,
      TradeType.EXACT_INPUT,
      {
        type: SwapType.SWAP_ROUTER_02,
        recipient: ethers.constants.AddressZero, // Not executing, just quoting
        slippageTolerance: this.slippageTolerance,
        deadline: Math.floor(Date.now() / 1000) + 1800, // 30 min deadline
      }
    );

    if (!route) {
      throw new Error("No route found");
    }

    const outputAmount = route.quote.toExact();
    const gasEstimate = route.estimatedGasUsed.toNumber();

    // Calculate effective price
    // For buy: effective_price = amountUsdt / outputAmount (USDT per token)
    // For sell: effective_price = outputAmount / amountUsdt (USDT per token)
    let effectivePrice: number;
    if (direction === "buy") {
      effectivePrice = amountUsdt / parseFloat(outputAmount);
    } else {
      effectivePrice = parseFloat(outputAmount) / amountUsdt;
    }

    // Safety validation
    if (effectivePrice <= 0 || effectivePrice > 10) {
      this.onLog("warn", "invalid_price", { price: effectivePrice });
      return {
        type: "uniswap.quote",
        pair: `${this.tokenOut.symbol}/${this.tokenIn.symbol}`,
        chain_id: this.chainId,
        ts: now,
        amount_in: amountUsdt.toString(),
        amount_in_unit: inputToken.symbol || "TOKEN",
        amount_out: "0",
        amount_out_unit: outputToken.symbol || "TOKEN",
        effective_price_usdt: 0,
        estimated_gas: 0,
        error: "Price out of reasonable bounds",
        is_stale: true,
        validated: false,
      };
    }

    // Mandatory diagnostic logging for real on-chain quotes
    this.onLog("info", "real_quote", {
      source: "uniswap_onchain",
      tokenIn: inputToken.symbol,
      tokenOut: outputToken.symbol,
      amountInUSDT: amountUsdt,
      amountOutToken: parseFloat(outputAmount),
      effectivePrice: effectivePrice,
      pool: route.routeString || "direct",
      feeTier: "0.3%",
      chainId: this.chainId,
      route: route.route.map((r) =>
        r.tokenPath.map((t) => t.symbol).join(" -> ")
      ),
    });

    const result: UniswapQuoteResult = {
      type: "uniswap.quote",
      pair: `${this.tokenOut.symbol}/${this.tokenIn.symbol}`,
      chain_id: this.chainId,
      ts: now,
      amount_in: amountUsdt.toString(),
      amount_in_unit: inputToken.symbol || "TOKEN",
      amount_out: outputAmount,
      amount_out_unit: outputToken.symbol || "TOKEN",
      effective_price_usdt: effectivePrice,
      estimated_gas: gasEstimate,
      route: {
        summary: route.routeString || "direct",
        pools: route.route.map((r) =>
          r.tokenPath.map((t) => t.symbol).join(" -> ")
        ),
      },
      is_stale: false,
      validated: true,
      source: "uniswap_onchain",
    };

    this.onLog("info", "quote_fetched", {
      pair: result.pair,
      amountIn: result.amount_in,
      amountOut: result.amount_out,
      effectivePrice: result.effective_price_usdt,
      gasEstimate: result.estimated_gas,
    });

    return result;
  }

  // Health check helpers
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  getCacheSize(): number {
    return this.cache.size;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.provider.getBlockNumber();
      return true;
    } catch {
      return false;
    }
  }
}
