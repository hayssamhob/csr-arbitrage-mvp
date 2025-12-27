import { ethers } from "ethers";
import { Config, TokenConfig } from "./config";
import { CachedQuote, UniswapQuoteResult } from "./schemas";
import { V4PoolReader } from "./v4PoolReader";

// ============================================================================
// Uniswap Quote Service - Simplified Implementation
// READ-ONLY: Attempts to read pool state, falls back to token validation
// No execution, no routing, no mock data
// ============================================================================

// Minimal ERC20 ABI to verify token exists
const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function balanceOf(address) external view returns (uint256)",
];

type LogFn = (
  level: string,
  event: string,
  data?: Record<string, unknown>
) => void;

export class QuoteService {
  private provider: ethers.providers.JsonRpcProvider;
  private tokenIn: Token;
  private tokenOut: Token;
  private chainId: number;
  private cacheTtlMs: number;
  private cache: Map<string, CachedQuote> = new Map();
  private consecutiveFailures = 0;
  private readonly onLog: LogFn;
  private poolId: string;
  private v4Reader: V4PoolReader;

  constructor(config: Config, onLog: LogFn) {
    this.chainId = config.CHAIN_ID;
    this.cacheTtlMs = config.QUOTE_CACHE_TTL_SECONDS * 1000;
    this.onLog = onLog;

    // Initialize provider - REAL ON-CHAIN DATA ONLY
    this.provider = new ethers.providers.JsonRpcProvider(config.RPC_URL);

    // Initialize V4 pool reader
    this.v4Reader = new V4PoolReader(
      this.provider,
      config.UNISWAP_V4_MANAGER_ADDRESS
    );

    // Initialize tokens from config
    this.tokenIn = this.createToken(config.TOKEN_IN_CONFIG);
    this.tokenOut = this.createToken(config.TOKEN_OUT_CONFIG);

    // Determine which pool ID to use based on token
    if (this.tokenOut.symbol === "CSR") {
      this.poolId = config.CSR_POOL_ID;
    } else if (this.tokenOut.symbol === "CSR25") {
      this.poolId = config.CSR25_POOL_ID;
    } else {
      throw new Error(`Unsupported token: ${this.tokenOut.symbol}`);
    }

    this.onLog("info", "uniswap_v4_quote_service_initialized", {
      chainId: this.chainId,
      tokenIn: this.tokenIn.symbol,
      tokenOut: this.tokenOut.symbol,
      poolId: this.poolId,
      managerAddress: config.UNISWAP_V4_MANAGER_ADDRESS,
    });
  }

  private createToken(config: TokenConfig): Token {
    return new Token(
      this.chainId,
      config.address,
      config.decimals,
      config.symbol
    );
  }

  async getQuote(
    amountUsdt: number,
    direction: "buy" | "sell"
  ): Promise<UniswapQuoteResult> {
    const cacheKey = `${amountUsdt}-${direction}`;
    const cached = this.cache.get(cacheKey);

    // Return fresh cache if available
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.quote;
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
        error: "Failed to fetch quote",
        is_stale: true,
        validated: false,
      };
    }
  }

  private async fetchQuote(
    amountUsdt: number,
    direction: "buy" | "sell"
  ): Promise<UniswapQuoteResult> {
    const now = new Date().toISOString();

    // Read real v4 pool state
    const poolState = await this.v4Reader.readPoolState(
      this.poolId,
      this.tokenIn,
      this.tokenOut
    );

    if (!poolState.exists) {
      this.onLog("warn", "pool_not_found", {
        poolId: this.poolId,
        token: this.tokenOut.symbol,
      });

      return {
        type: "uniswap.quote",
        pair: `${this.tokenOut.symbol}/${this.tokenIn.symbol}`,
        chain_id: this.chainId,
        ts: now,
        amount_in: amountUsdt.toString(),
        amount_in_unit: this.tokenIn.symbol || "USDT",
        amount_out: "0",
        amount_out_unit: this.tokenOut.symbol || "TOKEN",
        effective_price_usdt: 0,
        estimated_gas: 0,
        error: "Pool not found",
        is_stale: true,
        validated: false,
        source: "uniswap_v4_pool_state",
      };
    }

    // Calculate output amount
    let outputAmount: number;
    if (direction === "buy") {
      // Buying tokens with USDT
      outputAmount = amountUsdt / poolState.price;
    } else {
      // Selling tokens for USDT
      outputAmount = amountUsdt * poolState.price;
    }

    // Safety validation
    if (poolState.price <= 0 || poolState.price > 10) {
      this.onLog("warn", "invalid_price", {
        price: poolState.price,
        token: this.tokenOut.symbol,
      });

      return {
        type: "uniswap.quote",
        pair: `${this.tokenOut.symbol}/${this.tokenIn.symbol}`,
        chain_id: this.chainId,
        ts: now,
        amount_in: amountUsdt.toString(),
        amount_in_unit: this.tokenIn.symbol || "USDT",
        amount_out: "0",
        amount_out_unit: this.tokenOut.symbol || "TOKEN",
        effective_price_usdt: 0,
        estimated_gas: 0,
        error: "Price out of bounds",
        is_stale: true,
        validated: false,
        source: "uniswap_v4_pool_state",
      };
    }

    // Log successful quote
    this.onLog("info", "v4_pool_quote", {
      source: "uniswap_v4_pool_state",
      token: this.tokenOut.symbol,
      poolId: this.poolId,
      price: poolState.price,
      liquidity: poolState.liquidity,
      sqrtPriceX96: poolState.sqrtPriceX96,
      amountIn: amountUsdt,
      amountOut: outputAmount,
      executable: false,
    });

    return {
      type: "uniswap.quote",
      pair: `${this.tokenOut.symbol}/${this.tokenIn.symbol}`,
      chain_id: this.chainId,
      ts: now,
      amount_in: amountUsdt.toString(),
      amount_in_unit: this.tokenIn.symbol || "USDT",
      amount_out: outputAmount.toFixed(6),
      amount_out_unit: this.tokenOut.symbol || "TOKEN",
      effective_price_usdt: poolState.price,
      estimated_gas: 0,
      route: {
        summary: this.poolId,
        pools: [this.poolId],
      },
      is_stale: false,
      validated: true,
      source: "uniswap_v4_pool_state",
    };
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

// Simple Token class
class Token {
  constructor(
    public readonly chainId: number,
    public readonly address: string,
    public readonly decimals: number,
    public readonly symbol?: string,
    public readonly name?: string
  ) {}
}
