// ============================================================================
// Uniswap Quoter V2 Service - Real On-Chain Quotes
// Uses the official Uniswap QuoterV2 contract for accurate swap quotes
// This replaces subgraph mid-prices with actual executable prices
// ============================================================================

import { ethers } from "ethers";

// Uniswap V3 QuoterV2 contract on Ethereum mainnet
const QUOTER_V2_ADDRESS = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";

// Token addresses on Ethereum mainnet
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// QuoterV2 ABI - only the functions we need
const QUOTER_V2_ABI = [
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
];

// ERC20 ABI for decimals
const ERC20_ABI = [
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

export interface QuoterResult {
  amountIn: string;
  amountOut: string;
  effectivePrice: number;
  priceImpact: number;
  gasEstimate: number;
  fee: number;
  route: string;
  error?: string;
}

export interface TokenInfo {
  address: string;
  decimals: number;
  symbol: string;
}

type LogFn = (level: string, event: string, data?: Record<string, unknown>) => void;

export class QuoterV2Service {
  private provider: ethers.providers.JsonRpcProvider;
  private quoter: ethers.Contract;
  private onLog: LogFn;

  // Token configs
  private usdt: TokenInfo = { address: USDT_ADDRESS, decimals: 6, symbol: "USDT" };
  private csr: TokenInfo;
  private csr25: TokenInfo;

  // Fee tiers to try (in hundredths of a bip: 100 = 0.01%, 500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
  private feeTiers = [3000, 10000, 500, 100];

  constructor(
    rpcUrl: string,
    csrAddress: string,
    csr25Address: string,
    onLog: LogFn
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.quoter = new ethers.Contract(QUOTER_V2_ADDRESS, QUOTER_V2_ABI, this.provider);
    this.onLog = onLog;

    this.csr = { address: csrAddress, decimals: 18, symbol: "CSR" };
    this.csr25 = { address: csr25Address, decimals: 18, symbol: "CSR25" };
  }

  /**
   * Get a quote for buying tokens with USDT
   * @param token - "CSR" or "CSR25"
   * @param amountUsdt - Amount of USDT to spend
   */
  async getQuoteBuy(token: "CSR" | "CSR25", amountUsdt: number): Promise<QuoterResult> {
    const tokenInfo = token === "CSR" ? this.csr : this.csr25;
    const amountIn = ethers.utils.parseUnits(amountUsdt.toString(), this.usdt.decimals);

    // Try direct USDT -> Token path
    let result = await this.tryQuoteExactInput(
      this.usdt.address,
      tokenInfo.address,
      amountIn,
      this.usdt.decimals,
      tokenInfo.decimals
    );

    if (result.error) {
      // Try routing through WETH: USDT -> WETH -> Token
      result = await this.tryMultiHopQuote(
        this.usdt.address,
        tokenInfo.address,
        amountIn,
        this.usdt.decimals,
        tokenInfo.decimals
      );
    }

    if (!result.error) {
      // Calculate effective price (USDT per token)
      const amountOutFloat = parseFloat(ethers.utils.formatUnits(result.amountOut, tokenInfo.decimals));
      result.effectivePrice = amountUsdt / amountOutFloat;
      result.route = `${this.usdt.symbol} -> ${tokenInfo.symbol}`;
    }

    this.onLog("info", "quoter_v2_buy_quote", {
      token,
      amountUsdt,
      effectivePrice: result.effectivePrice,
      error: result.error,
    });

    return result;
  }

  /**
   * Get a quote for selling tokens for USDT
   * @param token - "CSR" or "CSR25"
   * @param amountTokens - Amount of tokens to sell
   */
  async getQuoteSell(token: "CSR" | "CSR25", amountTokens: number): Promise<QuoterResult> {
    const tokenInfo = token === "CSR" ? this.csr : this.csr25;
    const amountIn = ethers.utils.parseUnits(amountTokens.toString(), tokenInfo.decimals);

    // Try direct Token -> USDT path
    let result = await this.tryQuoteExactInput(
      tokenInfo.address,
      this.usdt.address,
      amountIn,
      tokenInfo.decimals,
      this.usdt.decimals
    );

    if (result.error) {
      // Try routing through WETH: Token -> WETH -> USDT
      result = await this.tryMultiHopQuote(
        tokenInfo.address,
        this.usdt.address,
        amountIn,
        tokenInfo.decimals,
        this.usdt.decimals
      );
    }

    if (!result.error) {
      // Calculate effective price (USDT per token)
      const amountOutFloat = parseFloat(ethers.utils.formatUnits(result.amountOut, this.usdt.decimals));
      result.effectivePrice = amountOutFloat / amountTokens;
      result.route = `${tokenInfo.symbol} -> ${this.usdt.symbol}`;
    }

    this.onLog("info", "quoter_v2_sell_quote", {
      token,
      amountTokens,
      effectivePrice: result.effectivePrice,
      error: result.error,
    });

    return result;
  }

  /**
   * Get the current price for 1 token in USDT
   */
  async getTokenPrice(token: "CSR" | "CSR25"): Promise<{ price: number; priceImpact: number; fee: number; gasEstimate: number; error?: string }> {
    // Quote selling 1 token for USDT
    const result = await this.getQuoteSell(token, 1);
    
    return {
      price: result.effectivePrice,
      priceImpact: result.priceImpact,
      fee: result.fee,
      gasEstimate: result.gasEstimate,
      error: result.error,
    };
  }

  private async tryQuoteExactInput(
    tokenIn: string,
    tokenOut: string,
    amountIn: ethers.BigNumber,
    decimalsIn: number,
    decimalsOut: number
  ): Promise<QuoterResult> {
    // Try each fee tier
    for (const fee of this.feeTiers) {
      try {
        const params = {
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          sqrtPriceLimitX96: 0,
        };

        // Use callStatic to simulate the quote without actually executing
        const result = await this.quoter.callStatic.quoteExactInputSingle(params);
        
        const amountOut = result.amountOut || result[0];
        const gasEstimate = result.gasEstimate || result[3];

        // Calculate price impact (simplified - would need spot price for accurate calculation)
        const amountInFloat = parseFloat(ethers.utils.formatUnits(amountIn, decimalsIn));
        const amountOutFloat = parseFloat(ethers.utils.formatUnits(amountOut, decimalsOut));

        return {
          amountIn: amountIn.toString(),
          amountOut: amountOut.toString(),
          effectivePrice: 0, // Will be calculated by caller
          priceImpact: 0, // Would need spot price comparison
          gasEstimate: gasEstimate ? gasEstimate.toNumber() : 150000,
          fee: fee / 10000, // Convert to percentage
          route: "direct",
        };
      } catch (err) {
        // Try next fee tier
        continue;
      }
    }

    return {
      amountIn: amountIn.toString(),
      amountOut: "0",
      effectivePrice: 0,
      priceImpact: 0,
      gasEstimate: 0,
      fee: 0,
      route: "none",
      error: "No liquidity found for direct path",
    };
  }

  private async tryMultiHopQuote(
    tokenIn: string,
    tokenOut: string,
    amountIn: ethers.BigNumber,
    decimalsIn: number,
    decimalsOut: number
  ): Promise<QuoterResult> {
    // Try routing through WETH
    // First hop: tokenIn -> WETH
    const hop1 = await this.tryQuoteExactInput(
      tokenIn,
      WETH_ADDRESS,
      amountIn,
      decimalsIn,
      18 // WETH decimals
    );

    if (hop1.error) {
      return {
        amountIn: amountIn.toString(),
        amountOut: "0",
        effectivePrice: 0,
        priceImpact: 0,
        gasEstimate: 0,
        fee: 0,
        route: "none",
        error: "No liquidity found via WETH routing",
      };
    }

    // Second hop: WETH -> tokenOut
    const hop2 = await this.tryQuoteExactInput(
      WETH_ADDRESS,
      tokenOut,
      ethers.BigNumber.from(hop1.amountOut),
      18, // WETH decimals
      decimalsOut
    );

    if (hop2.error) {
      return {
        amountIn: amountIn.toString(),
        amountOut: "0",
        effectivePrice: 0,
        priceImpact: 0,
        gasEstimate: 0,
        fee: 0,
        route: "none",
        error: "No liquidity found via WETH routing",
      };
    }

    return {
      amountIn: amountIn.toString(),
      amountOut: hop2.amountOut,
      effectivePrice: 0, // Will be calculated by caller
      priceImpact: hop1.priceImpact + hop2.priceImpact,
      gasEstimate: hop1.gasEstimate + hop2.gasEstimate,
      fee: hop1.fee + hop2.fee,
      route: "via WETH",
    };
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
