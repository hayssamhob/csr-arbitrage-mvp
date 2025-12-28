import { ethers } from "ethers";
import { Config, TokenConfig } from "./config";
import { DefiLlamaService } from "./defiLlamaService";
import { QuoterV2Service } from "./quoterV2Service";
import { CachedQuote, UniswapQuoteResult } from "./schemas";
import { V4SubgraphGatewayReader } from "./v4SubgraphGatewayReader";

// ============================================================================
// Uniswap Quote Service - Uses Uniswap API for Real Prices
// READ-ONLY: Returns actual executable swap prices from Uniswap
// Falls back to V4 subgraph if QuoterV2 fails
// No execution, no signing.
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
  private v4Reader: V4SubgraphGatewayReader;
  private quoterV2: QuoterV2Service;
  private defiLlama: DefiLlamaService;
  private usdtToken: TokenConfig;
  private csrToken: TokenConfig;
  private csr25Token: TokenConfig;

  constructor(config: Config, onLog: LogFn) {
    this.chainId = config.CHAIN_ID;
    this.cacheTtlMs = config.QUOTE_CACHE_TTL_SECONDS * 1000;
    this.onLog = onLog;

    // Initialize provider - REAL ON-CHAIN DATA ONLY
    this.provider = new ethers.providers.JsonRpcProvider(config.RPC_URL);

    // Initialize DeFi Llama service (PRIMARY SOURCE - real market prices)
    this.defiLlama = new DefiLlamaService(onLog);

    // Initialize QuoterV2 for on-chain quotes (FALLBACK 1)
    this.quoterV2 = new QuoterV2Service(
      config.RPC_URL,
      config.CSR_CONFIG.address,
      config.CSR25_CONFIG.address,
      onLog
    );

    // Initialize V4 subgraph reader (FALLBACK 2)
    const subgraphUrl = `https://gateway.thegraph.com/api/${config.GRAPH_API_KEY}/subgraphs/id/${config.UNISWAP_V4_SUBGRAPH_ID}`;
    this.v4Reader = new V4SubgraphGatewayReader(subgraphUrl);

    // Initialize token configs
    this.usdtToken = config.USDT_CONFIG;
    this.csrToken = config.CSR_CONFIG;
    this.csr25Token = config.CSR25_CONFIG;

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

    this.onLog("info", "uniswap_quote_service_initialized", {
      chainId: this.chainId,
      tokenIn: this.tokenIn.symbol,
      tokenOut: this.tokenOut.symbol,
      poolId: this.poolId,
      source: "quoter_v2_primary",
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

    // Determine which token we're quoting
    const targetToken =
      this.tokenOut.symbol === "CSR" ? this.csrToken : this.csr25Token;
    const tokenType = targetToken.symbol === "CSR" ? "CSR" : "CSR25";

    // PRIMARY: Try DeFi Llama for real market prices
    try {
      const priceResult = await this.defiLlama.getTokenPrice(
        tokenType as "CSR" | "CSR25"
      );

      if (!priceResult.error && priceResult.price > 0) {
        this.onLog("info", "defillama_success", {
          token: targetToken.symbol,
          price: priceResult.price,
          confidence: priceResult.confidence,
        });

        // Calculate output amount
        let outputAmount: number;
        if (direction === "buy") {
          outputAmount = amountUsdt / priceResult.price;
        } else {
          outputAmount = amountUsdt * priceResult.price;
        }

        return {
          type: "uniswap.quote",
          pair: `${targetToken.symbol}/USDT`,
          chain_id: this.chainId,
          ts: now,
          amount_in: amountUsdt.toString(),
          amount_in_unit: direction === "buy" ? "USDT" : targetToken.symbol,
          amount_out: outputAmount.toFixed(6),
          amount_out_unit: direction === "buy" ? targetToken.symbol : "USDT",
          effective_price_usdt: priceResult.price,
          estimated_gas: 150000, // Standard gas estimate
          pool_fee: 0.3, // Standard fee
          is_stale: false,
          validated: true,
          source: "defillama",
        };
      }

      this.onLog("warn", "defillama_failed_trying_quoter", {
        token: targetToken.symbol,
        error: priceResult.error,
      });
    } catch (apiError) {
      this.onLog("warn", "defillama_exception", {
        error: apiError instanceof Error ? apiError.message : String(apiError),
      });
    }

    // FALLBACK 1: Try QuoterV2 for on-chain quotes
    try {
      const quoterResult =
        direction === "buy"
          ? await this.quoterV2.getQuoteBuy(
              tokenType as "CSR" | "CSR25",
              amountUsdt
            )
          : await this.quoterV2.getQuoteSell(
              tokenType as "CSR" | "CSR25",
              amountUsdt
            );

      if (!quoterResult.error && quoterResult.effectivePrice > 0) {
        this.onLog("info", "quoter_v2_success", {
          token: targetToken.symbol,
          price: quoterResult.effectivePrice,
          fee: quoterResult.fee,
          gasEstimate: quoterResult.gasEstimate,
        });

        let outputAmount: number;
        if (direction === "buy") {
          outputAmount = amountUsdt / quoterResult.effectivePrice;
        } else {
          outputAmount = amountUsdt * quoterResult.effectivePrice;
        }

        return {
          type: "uniswap.quote",
          pair: `${targetToken.symbol}/USDT`,
          chain_id: this.chainId,
          ts: now,
          amount_in: amountUsdt.toString(),
          amount_in_unit: direction === "buy" ? "USDT" : targetToken.symbol,
          amount_out: outputAmount.toFixed(6),
          amount_out_unit: direction === "buy" ? targetToken.symbol : "USDT",
          effective_price_usdt: quoterResult.effectivePrice,
          estimated_gas: quoterResult.gasEstimate,
          pool_fee: quoterResult.fee,
          price_impact: quoterResult.priceImpact,
          is_stale: false,
          validated: true,
          source: "quoter_v2",
        };
      }

      this.onLog("warn", "quoter_v2_failed_trying_subgraph", {
        token: targetToken.symbol,
        error: quoterResult.error,
      });
    } catch (quoterError) {
      this.onLog("warn", "quoter_v2_exception", {
        error:
          quoterError instanceof Error
            ? quoterError.message
            : String(quoterError),
      });
    }

    // FALLBACK: Try V4 subgraph
    const pool = await this.v4Reader.fetchPoolByTokens(
      targetToken.address,
      this.usdtToken.address
    );

    if (!pool) {
      this.onLog("warn", "pool_not_found", {
        poolId: this.poolId,
        token: targetToken.symbol,
      });

      return {
        type: "uniswap.quote",
        pair: `${targetToken.symbol}/USDT`,
        chain_id: this.chainId,
        ts: now,
        amount_in: amountUsdt.toString(),
        amount_in_unit: "USDT",
        amount_out: "0",
        amount_out_unit: targetToken.symbol,
        effective_price_usdt: 0,
        estimated_gas: 0,
        error: "No liquidity found",
        is_stale: true,
        validated: false,
        source: "none",
      };
    }

    // Step C: Compute USDT per token price
    const priceUsdtPerToken = this.v4Reader.computePrice(
      pool,
      this.usdtToken.address,
      this.usdtToken.decimals,
      targetToken.decimals
    );

    // Safety validation
    if (priceUsdtPerToken <= 0 || priceUsdtPerToken > 10) {
      this.onLog("warn", "invalid_price", {
        price: priceUsdtPerToken,
        token: targetToken.symbol,
      });

      return {
        type: "uniswap.quote",
        pair: `${targetToken.symbol}/USDT`,
        chain_id: this.chainId,
        ts: now,
        amount_in: amountUsdt.toString(),
        amount_in_unit: "USDT",
        amount_out: "0",
        amount_out_unit: targetToken.symbol,
        effective_price_usdt: 0,
        estimated_gas: 0,
        error: "Price out of bounds",
        is_stale: true,
        validated: false,
        source: "uniswap_v4_subgraph",
      };
    }

    // Calculate output amount
    let outputAmount: number;
    if (direction === "buy") {
      // Buying tokens with USDT
      outputAmount = amountUsdt / priceUsdtPerToken;
    } else {
      // Selling tokens for USDT
      outputAmount = amountUsdt * priceUsdtPerToken;
    }

    // Log successful quote
    this.onLog("info", "v4_subgraph_quote", {
      source: "uniswap_v4_subgraph",
      token: targetToken.symbol,
      poolId: pool.poolId,
      price: priceUsdtPerToken,
      sqrtPriceX96: pool.sqrtPriceX96,
      tick: pool.tick,
      amountIn: amountUsdt,
      amountOut: outputAmount,
      executable: false,
    });

    return {
      type: "uniswap.quote",
      pair: `${targetToken.symbol}/USDT`,
      chain_id: this.chainId,
      ts: now,
      amount_in: amountUsdt.toString(),
      amount_in_unit: "USDT",
      amount_out: outputAmount.toFixed(6),
      amount_out_unit: targetToken.symbol,
      effective_price_usdt: priceUsdtPerToken,
      estimated_gas: 0,
      route: {
        summary: pool.poolId,
        pools: [pool.poolId],
      },
      is_stale: false,
      validated: true,
      source: "uniswap_v4_subgraph",
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
