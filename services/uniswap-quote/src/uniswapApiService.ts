// ============================================================================
// Uniswap Swap API Service - Uses Official Uniswap API for Real Quotes
// This is the same API that the Uniswap frontend uses
// Returns actual executable prices with routing, fees, and price impact
// ============================================================================

// Token addresses on Ethereum mainnet
const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const CSR_ADDRESS = "0x75Ecb52e403C617679FBd3e77A50f9d10A842387";
const CSR25_ADDRESS = "0x502e7230e142a332dfed1095f7174834b2548982";

// Uniswap API endpoints
const UNISWAP_API_BASE = "https://api.uniswap.org/v2";

export interface UniswapApiQuote {
  price: number;
  priceImpact: number;
  gasFeeUSD: number;
  routeString: string;
  amountIn: string;
  amountOut: string;
  error?: string;
}

type LogFn = (level: string, event: string, data?: Record<string, unknown>) => void;

export class UniswapApiService {
  private onLog: LogFn;

  constructor(onLog: LogFn) {
    this.onLog = onLog;
  }

  /**
   * Get quote for selling 1 token for USDT (to determine token price)
   */
  async getTokenPrice(token: "CSR" | "CSR25"): Promise<UniswapApiQuote> {
    const tokenAddress = token === "CSR" ? CSR_ADDRESS : CSR25_ADDRESS;
    
    // Sell 1 token for USDT
    return this.getQuote({
      tokenIn: tokenAddress,
      tokenOut: USDT_ADDRESS,
      amount: "1000000000000000000", // 1 token (18 decimals)
      type: "EXACT_INPUT",
    });
  }

  /**
   * Get quote for buying tokens with USDT
   */
  async getQuoteBuy(token: "CSR" | "CSR25", amountUsdt: number): Promise<UniswapApiQuote> {
    const tokenAddress = token === "CSR" ? CSR_ADDRESS : CSR25_ADDRESS;
    
    // USDT has 6 decimals
    const amountIn = (amountUsdt * 1e6).toString();
    
    return this.getQuote({
      tokenIn: USDT_ADDRESS,
      tokenOut: tokenAddress,
      amount: amountIn,
      type: "EXACT_INPUT",
    });
  }

  /**
   * Get quote for selling tokens for USDT
   */
  async getQuoteSell(token: "CSR" | "CSR25", amountTokens: number): Promise<UniswapApiQuote> {
    const tokenAddress = token === "CSR" ? CSR_ADDRESS : CSR25_ADDRESS;
    
    // Tokens have 18 decimals
    const amountIn = (amountTokens * 1e18).toString();
    
    return this.getQuote({
      tokenIn: tokenAddress,
      tokenOut: USDT_ADDRESS,
      amount: amountIn,
      type: "EXACT_INPUT",
    });
  }

  private async getQuote(params: {
    tokenIn: string;
    tokenOut: string;
    amount: string;
    type: "EXACT_INPUT" | "EXACT_OUTPUT";
  }): Promise<UniswapApiQuote> {
    try {
      // Use the Uniswap quote endpoint
      const url = `${UNISWAP_API_BASE}/quote`;
      
      const requestBody = {
        tokenInChainId: 1,
        tokenOutChainId: 1,
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amount: params.amount,
        type: params.type,
        protocols: ["V2", "V3", "V4"],
        slippageTolerance: 0.5,
      };

      this.onLog("debug", "uniswap_api_request", { url, body: requestBody });

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Origin": "https://app.uniswap.org",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.onLog("warn", "uniswap_api_error", { 
          status: response.status, 
          error: errorText 
        });
        
        return {
          price: 0,
          priceImpact: 0,
          gasFeeUSD: 0,
          routeString: "",
          amountIn: params.amount,
          amountOut: "0",
          error: `API error: ${response.status}`,
        };
      }

      const data = await response.json();
      
      this.onLog("info", "uniswap_api_response", {
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        quote: data.quote,
        priceImpact: data.priceImpact,
      });

      // Parse the response
      const amountIn = data.quote?.amountIn || params.amount;
      const amountOut = data.quote?.amountOut || "0";
      
      // Calculate effective price
      const tokenInDecimals = params.tokenIn.toLowerCase() === USDT_ADDRESS.toLowerCase() ? 6 : 18;
      const tokenOutDecimals = params.tokenOut.toLowerCase() === USDT_ADDRESS.toLowerCase() ? 6 : 18;
      
      const amountInFloat = parseFloat(amountIn) / Math.pow(10, tokenInDecimals);
      const amountOutFloat = parseFloat(amountOut) / Math.pow(10, tokenOutDecimals);
      
      let price = 0;
      if (params.tokenOut.toLowerCase() === USDT_ADDRESS.toLowerCase()) {
        // Selling token for USDT - price is USDT per token
        price = amountOutFloat / amountInFloat;
      } else {
        // Buying token with USDT - price is USDT per token
        price = amountInFloat / amountOutFloat;
      }

      return {
        price,
        priceImpact: parseFloat(data.priceImpact || "0"),
        gasFeeUSD: parseFloat(data.gasFeeUSD || "0"),
        routeString: data.routeString || "Uniswap API",
        amountIn,
        amountOut,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.onLog("error", "uniswap_api_exception", { error: errorMsg });
      
      return {
        price: 0,
        priceImpact: 0,
        gasFeeUSD: 0,
        routeString: "",
        amountIn: params.amount,
        amountOut: "0",
        error: errorMsg,
      };
    }
  }
}
