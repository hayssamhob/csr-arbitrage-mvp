import { ethers } from "ethers";

// Uniswap HTTP Quote Service - Calls Uniswap API directly for real prices
// This uses the same endpoint that the Uniswap UI uses

type LogFn = (
  level: string,
  event: string,
  data?: Record<string, unknown>
) => void;

// CORRECT token addresses (verified from Uniswap URL)
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const CSR_ADDRESS = "0x75Ecb52e403C617679FBd3e77A50f9d10A842387"; // From Uniswap URL
const CSR25_ADDRESS = "0x502e7230e142a332dfed1095f7174834b2548982";

export interface QuoteResult {
  effectivePrice: number;
  amountIn: string;
  amountOut: string;
  gasEstimateUsd: number;
  priceImpactPercent: number;
  route: string;
  source: string;
  error?: string;
}

export class UniswapHttpQuoteService {
  private readonly onLog: LogFn;
  private readonly provider: ethers.providers.JsonRpcProvider;

  constructor(rpcUrl: string, onLog: LogFn) {
    this.onLog = onLog;
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  }

  /**
   * Get the price of 1 token in USDT by querying the QuoterV2 contract
   */
  async getTokenPrice(token: "CSR" | "CSR25"): Promise<QuoteResult> {
    const tokenAddress = token === "CSR" ? CSR_ADDRESS : CSR25_ADDRESS;
    
    // Quote: Sell 1000 tokens for USDT to get accurate price
    const amountTokens = 1000;
    const result = await this.quoteSellTokens(tokenAddress, amountTokens);
    
    return result;
  }

  /**
   * Get quote for selling tokens for USDT using QuoterV2
   */
  private async quoteSellTokens(
    tokenAddress: string,
    amountTokens: number
  ): Promise<QuoteResult> {
    // QuoterV2 contract address on Ethereum mainnet
    const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
    
    // QuoterV2 ABI for quoteExactInputSingle
    const quoterAbi = [
      "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    ];

    const quoter = new ethers.Contract(QUOTER_V2, quoterAbi, this.provider);

    // Convert token amount to wei (18 decimals)
    const amountInWei = ethers.utils.parseUnits(amountTokens.toString(), 18);

    // Try different fee tiers: 1% (10000), 0.3% (3000), 0.05% (500)
    const feeTiers = [10000, 3000, 500];
    
    for (const fee of feeTiers) {
      try {
        const params = {
          tokenIn: tokenAddress,
          tokenOut: USDT_ADDRESS,
          amountIn: amountInWei,
          fee,
          sqrtPriceLimitX96: 0,
        };

        this.onLog("debug", "quoter_v2_call", {
          tokenIn: tokenAddress,
          amountTokens,
          fee,
        });

        const result = await quoter.callStatic.quoteExactInputSingle(params);
        const amountOutUsdt = result.amountOut || result[0];
        const gasEstimate = result.gasEstimate || result[3] || 150000;

        // USDT has 6 decimals
        const amountOutFormatted = parseFloat(
          ethers.utils.formatUnits(amountOutUsdt, 6)
        );

        // Calculate price: USDT received / tokens sold
        const effectivePrice = amountOutFormatted / amountTokens;

        // Estimate gas cost in USD
        const gasPrice = await this.provider.getGasPrice();
        const gasCostWei = gasPrice.mul(gasEstimate);
        const gasCostEth = parseFloat(ethers.utils.formatEther(gasCostWei));
        const ethPrice = 3500; // Could fetch dynamically
        const gasCostUsd = gasCostEth * ethPrice;

        this.onLog("info", "quoter_v2_success", {
          tokenAddress,
          amountTokens,
          amountOutUsdt: amountOutFormatted,
          effectivePrice,
          fee: fee / 10000,
          gasEstimate: gasEstimate.toString(),
        });

        return {
          effectivePrice,
          amountIn: amountTokens.toString(),
          amountOut: amountOutFormatted.toFixed(6),
          gasEstimateUsd: gasCostUsd,
          priceImpactPercent: -0.34, // Estimated for small trades
          route: `V3 ${fee / 10000}% pool`,
          source: "quoter_v2",
        };
      } catch (error) {
        this.onLog("debug", "quoter_v2_fee_tier_failed", {
          fee,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    // All fee tiers failed
    this.onLog("error", "quoter_v2_all_tiers_failed", { tokenAddress });
    return {
      effectivePrice: 0,
      amountIn: amountTokens.toString(),
      amountOut: "0",
      gasEstimateUsd: 0,
      priceImpactPercent: 0,
      route: "none",
      source: "quoter_v2_failed",
      error: "No liquidity found",
    };
  }

  /**
   * Get quote for buying tokens with USDT
   */
  async quoteBuyTokens(
    token: "CSR" | "CSR25",
    amountUsdt: number
  ): Promise<QuoteResult> {
    const tokenAddress = token === "CSR" ? CSR_ADDRESS : CSR25_ADDRESS;
    const QUOTER_V2 = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
    
    const quoterAbi = [
      "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
    ];

    const quoter = new ethers.Contract(QUOTER_V2, quoterAbi, this.provider);

    // USDT has 6 decimals
    const amountInWei = ethers.utils.parseUnits(amountUsdt.toString(), 6);

    const feeTiers = [10000, 3000, 500];
    
    for (const fee of feeTiers) {
      try {
        const params = {
          tokenIn: USDT_ADDRESS,
          tokenOut: tokenAddress,
          amountIn: amountInWei,
          fee,
          sqrtPriceLimitX96: 0,
        };

        const result = await quoter.callStatic.quoteExactInputSingle(params);
        const amountOutTokens = result.amountOut || result[0];
        const gasEstimate = result.gasEstimate || result[3] || 150000;

        // Token has 18 decimals
        const amountOutFormatted = parseFloat(
          ethers.utils.formatUnits(amountOutTokens, 18)
        );

        // Calculate price: USDT spent / tokens received
        const effectivePrice = amountUsdt / amountOutFormatted;

        const gasPrice = await this.provider.getGasPrice();
        const gasCostWei = gasPrice.mul(gasEstimate);
        const gasCostEth = parseFloat(ethers.utils.formatEther(gasCostWei));
        const gasCostUsd = gasCostEth * 3500;

        this.onLog("info", "quoter_v2_buy_success", {
          token,
          amountUsdt,
          amountOutTokens: amountOutFormatted,
          effectivePrice,
          fee: fee / 10000,
        });

        return {
          effectivePrice,
          amountIn: amountUsdt.toString(),
          amountOut: amountOutFormatted.toFixed(6),
          gasEstimateUsd: gasCostUsd,
          priceImpactPercent: -0.34,
          route: `V3 ${fee / 10000}% pool`,
          source: "quoter_v2",
        };
      } catch {
        continue;
      }
    }

    return {
      effectivePrice: 0,
      amountIn: amountUsdt.toString(),
      amountOut: "0",
      gasEstimateUsd: 0,
      priceImpactPercent: 0,
      route: "none",
      source: "quoter_v2_failed",
      error: "No liquidity found",
    };
  }
}
