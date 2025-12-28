// ============================================================================
// Uniswap Smart Order Router Service
// Uses the official Uniswap SDK to get REAL executable swap quotes
// This is the same routing engine that the Uniswap UI uses
// Returns actual execution prices with gas estimates and price impact
// ============================================================================

import { CurrencyAmount, Percent, Token, TradeType } from "@uniswap/sdk-core";
import { AlphaRouter, SwapType } from "@uniswap/smart-order-router";
import { ethers } from "ethers";

// Token addresses on Ethereum mainnet
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const CSR_ADDRESS = "0x75Ecb52e403C617679FBd3e77A50f9d10A842387";
const CSR25_ADDRESS = "0x502e7230e142a332dfed1095f7174834b2548982";

// Chain ID for Ethereum mainnet
const CHAIN_ID = 1;

export interface SwapQuote {
  amountIn: string;
  amountOut: string;
  executionPrice: number; // Price in USDT per token
  priceImpact: number; // Percentage
  gasEstimateUSD: number;
  gasEstimateGwei: number;
  route: string;
  protocols: string[];
  error?: string;
}

type LogFn = (level: string, event: string, data?: Record<string, unknown>) => void;

export class SmartRouterService {
  private provider: ethers.providers.JsonRpcProvider;
  private router: AlphaRouter;
  private onLog: LogFn;

  // Token definitions
  private usdt: Token;
  private csr: Token;
  private csr25: Token;

  constructor(rpcUrl: string, onLog: LogFn) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.onLog = onLog;

    // Initialize the Alpha Router (Smart Order Router)
    this.router = new AlphaRouter({
      chainId: CHAIN_ID,
      provider: this.provider,
    });

    // Define tokens
    this.usdt = new Token(CHAIN_ID, USDT_ADDRESS, 6, "USDT", "Tether USD");
    this.csr = new Token(CHAIN_ID, CSR_ADDRESS, 18, "CSR", "CSR Token");
    this.csr25 = new Token(CHAIN_ID, CSR25_ADDRESS, 18, "CSR25", "CSR25 Token");

    this.onLog("info", "smart_router_initialized", { chainId: CHAIN_ID });
  }

  /**
   * Get the price of 1 token in USDT by simulating a sell
   */
  async getTokenPrice(token: "CSR" | "CSR25"): Promise<SwapQuote> {
    // Sell 1 token for USDT to get the price
    return this.getQuoteSell(token, 1);
  }

  /**
   * Get quote for buying tokens with USDT
   * @param token - "CSR" or "CSR25"
   * @param amountUsdt - Amount of USDT to spend
   */
  async getQuoteBuy(token: "CSR" | "CSR25", amountUsdt: number): Promise<SwapQuote> {
    const tokenOut = token === "CSR" ? this.csr : this.csr25;
    
    // Create the input amount (USDT with 6 decimals)
    const amountIn = CurrencyAmount.fromRawAmount(
      this.usdt,
      ethers.utils.parseUnits(amountUsdt.toString(), 6).toString()
    );

    return this.executeRoute(amountIn, tokenOut, TradeType.EXACT_INPUT, "buy");
  }

  /**
   * Get quote for selling tokens for USDT
   * @param token - "CSR" or "CSR25"
   * @param amountTokens - Amount of tokens to sell
   */
  async getQuoteSell(token: "CSR" | "CSR25", amountTokens: number): Promise<SwapQuote> {
    const tokenIn = token === "CSR" ? this.csr : this.csr25;
    
    // Create the input amount (token with 18 decimals)
    const amountIn = CurrencyAmount.fromRawAmount(
      tokenIn,
      ethers.utils.parseUnits(amountTokens.toString(), 18).toString()
    );

    return this.executeRoute(amountIn, this.usdt, TradeType.EXACT_INPUT, "sell");
  }

  private async executeRoute(
    amountIn: CurrencyAmount<Token>,
    tokenOut: Token,
    tradeType: TradeType,
    direction: "buy" | "sell"
  ): Promise<SwapQuote> {
    try {
      this.onLog("debug", "smart_router_request", {
        tokenIn: amountIn.currency.symbol,
        tokenOut: tokenOut.symbol,
        amount: amountIn.toExact(),
        direction,
      });

      // Get the route from the Smart Order Router
      const route = await this.router.route(
        amountIn,
        tokenOut,
        tradeType,
        {
          type: SwapType.SWAP_ROUTER_02,
          recipient: "0x0000000000000000000000000000000000000001", // Dummy address for quote
          slippageTolerance: new Percent(50, 10000), // 0.5% slippage
          deadline: Math.floor(Date.now() / 1000) + 1800, // 30 minutes
        }
      );

      if (!route) {
        this.onLog("warn", "smart_router_no_route", {
          tokenIn: amountIn.currency.symbol,
          tokenOut: tokenOut.symbol,
        });

        return {
          amountIn: amountIn.toExact(),
          amountOut: "0",
          executionPrice: 0,
          priceImpact: 0,
          gasEstimateUSD: 0,
          gasEstimateGwei: 0,
          route: "none",
          protocols: [],
          error: "No route found",
        };
      }

      // Extract quote details
      const amountOut = route.quote.toExact();
      const gasEstimateUSD = parseFloat(route.estimatedGasUsedUSD?.toExact() || "0");
      const gasEstimateGwei = route.estimatedGasUsed?.toNumber() || 0;
      const priceImpact = parseFloat(route.trade?.priceImpact?.toFixed(4) || "0");

      // Calculate execution price (USDT per token)
      let executionPrice: number;
      if (direction === "buy") {
        // Buying tokens with USDT: price = USDT spent / tokens received
        executionPrice = parseFloat(amountIn.toExact()) / parseFloat(amountOut);
      } else {
        // Selling tokens for USDT: price = USDT received / tokens sold
        executionPrice = parseFloat(amountOut) / parseFloat(amountIn.toExact());
      }

      // Build route description
      const routeDesc = route.route
        .map(r => r.tokenPath.map(t => t.symbol).join(" → "))
        .join(" | ");

      // Get protocols used
      const protocols = route.route.map(r => r.protocol);

      this.onLog("info", "smart_router_quote", {
        direction,
        tokenIn: amountIn.currency.symbol,
        tokenOut: tokenOut.symbol,
        amountIn: amountIn.toExact(),
        amountOut,
        executionPrice,
        priceImpact,
        gasEstimateUSD,
        route: routeDesc,
        protocols,
      });

      return {
        amountIn: amountIn.toExact(),
        amountOut,
        executionPrice,
        priceImpact,
        gasEstimateUSD,
        gasEstimateGwei,
        route: routeDesc,
        protocols: protocols as string[],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.onLog("error", "smart_router_error", { error: errorMsg });

      return {
        amountIn: amountIn.toExact(),
        amountOut: "0",
        executionPrice: 0,
        priceImpact: 0,
        gasEstimateUSD: 0,
        gasEstimateGwei: 0,
        route: "none",
        protocols: [],
        error: errorMsg,
      };
    }
  }

  /**
   * Build a transaction for executing a swap
   * This returns the transaction data needed to execute the swap
   */
  async buildSwapTransaction(
    token: "CSR" | "CSR25",
    amountUsdt: number,
    direction: "buy" | "sell",
    recipientAddress: string,
    slippagePercent: number = 0.5
  ): Promise<{
    to: string;
    data: string;
    value: string;
    gasLimit: string;
    quote: SwapQuote;
  } | { error: string }> {
    try {
      const tokenObj = token === "CSR" ? this.csr : this.csr25;
      
      let amountIn: CurrencyAmount<Token>;
      let tokenOut: Token;
      
      if (direction === "buy") {
        amountIn = CurrencyAmount.fromRawAmount(
          this.usdt,
          ethers.utils.parseUnits(amountUsdt.toString(), 6).toString()
        );
        tokenOut = tokenObj;
      } else {
        amountIn = CurrencyAmount.fromRawAmount(
          tokenObj,
          ethers.utils.parseUnits(amountUsdt.toString(), 18).toString()
        );
        tokenOut = this.usdt;
      }

      const route = await this.router.route(
        amountIn,
        tokenOut,
        TradeType.EXACT_INPUT,
        {
          type: SwapType.SWAP_ROUTER_02,
          recipient: recipientAddress,
          slippageTolerance: new Percent(Math.floor(slippagePercent * 100), 10000),
          deadline: Math.floor(Date.now() / 1000) + 1800,
        }
      );

      if (!route || !route.methodParameters) {
        return { error: "No route found for swap" };
      }

      const quote = await (direction === "buy" 
        ? this.getQuoteBuy(token, amountUsdt)
        : this.getQuoteSell(token, amountUsdt));

      return {
        to: route.methodParameters.to,
        data: route.methodParameters.calldata,
        value: route.methodParameters.value,
        gasLimit: route.estimatedGasUsed?.toString() || "300000",
        quote,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return { error: errorMsg };
    }
  }
}
