// ============================================================================
// DeFi Llama Price Service - Gets Real Token Prices
// Uses the free DeFi Llama API for accurate current prices
// ============================================================================

// Token addresses on Ethereum mainnet
const CSR_ADDRESS = "0x75Ecb52e403C617679FBd3e77A50f9d10A842387";
const CSR25_ADDRESS = "0x502e7230e142a332dfed1095f7174834b2548982";

// DeFi Llama API endpoint
const DEFILLAMA_API = "https://coins.llama.fi/prices/current";

export interface TokenPrice {
  price: number;
  symbol: string;
  timestamp: number;
  confidence: number;
  error?: string;
}

type LogFn = (level: string, event: string, data?: Record<string, unknown>) => void;

export class DefiLlamaService {
  private onLog: LogFn;
  private cache: Map<string, { price: TokenPrice; cachedAt: number }> = new Map();
  private cacheTtlMs = 30000; // 30 seconds cache

  constructor(onLog: LogFn) {
    this.onLog = onLog;
  }

  async getTokenPrice(token: "CSR" | "CSR25"): Promise<TokenPrice> {
    const tokenAddress = token === "CSR" ? CSR_ADDRESS : CSR25_ADDRESS;
    const cacheKey = token;

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.price;
    }

    try {
      // DeFi Llama uses format: ethereum:0x...
      const coinId = `ethereum:${tokenAddress}`;
      const url = `${DEFILLAMA_API}/${coinId}`;

      this.onLog("debug", "defillama_request", { url, token });

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.onLog("warn", "defillama_error", {
          status: response.status,
          error: errorText,
        });

        return {
          price: 0,
          symbol: token,
          timestamp: Date.now(),
          confidence: 0,
          error: `API error: ${response.status}`,
        };
      }

      const data = await response.json();
      const coinData = data.coins?.[coinId];

      if (!coinData) {
        this.onLog("warn", "defillama_no_data", { token, coinId });
        return {
          price: 0,
          symbol: token,
          timestamp: Date.now(),
          confidence: 0,
          error: "Token not found in DeFi Llama",
        };
      }

      const result: TokenPrice = {
        price: coinData.price || 0,
        symbol: coinData.symbol || token,
        timestamp: coinData.timestamp || Date.now(),
        confidence: coinData.confidence || 1,
      };

      this.onLog("info", "defillama_price", {
        token,
        price: result.price,
        symbol: result.symbol,
        confidence: result.confidence,
      });

      // Cache the result
      this.cache.set(cacheKey, { price: result, cachedAt: Date.now() });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.onLog("error", "defillama_exception", { error: errorMsg });

      return {
        price: 0,
        symbol: token,
        timestamp: Date.now(),
        confidence: 0,
        error: errorMsg,
      };
    }
  }

  async getBothPrices(): Promise<{ csr: TokenPrice; csr25: TokenPrice }> {
    const [csr, csr25] = await Promise.all([
      this.getTokenPrice("CSR"),
      this.getTokenPrice("CSR25"),
    ]);
    return { csr, csr25 };
  }
}
