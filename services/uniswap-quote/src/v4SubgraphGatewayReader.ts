// ============================================================================
// Uniswap v4 Subgraph Reader (via The Graph Gateway)
// Fetches pool data from Uniswap v4 subgraph using API key authentication
// V4 Schema: id, poolId, currency0, currency1, fee, tickSpacing, hooks, sqrtPriceX96, tick
// ============================================================================

export interface PoolData {
  id: string;
  poolId: string;
  fee: number;
  sqrtPriceX96: string;
  tick: number;
  currency0: string;
  currency1: string;
}

export class V4SubgraphGatewayReader {
  private subgraphUrl: string;

  constructor(subgraphUrl: string) {
    this.subgraphUrl = subgraphUrl;
  }

  async fetchPoolByTokens(
    tokenAddress: string,
    usdtAddress: string
  ): Promise<PoolData | null> {
    // V4 subgraph uses currency0/currency1 (addresses only, lowercase)
    // Try both orderings since we don't know which is token0
    const token = tokenAddress.toLowerCase();
    const usdt = usdtAddress.toLowerCase();

    const query = `
      query findPool($token: Bytes!, $usdt: Bytes!) {
        a: pools(where: { currency0: $token, currency1: $usdt }, first: 1) {
          id poolId fee sqrtPriceX96 tick currency0 currency1
        }
        b: pools(where: { currency0: $usdt, currency1: $token }, first: 1) {
          id poolId fee sqrtPriceX96 tick currency0 currency1
        }
      }
    `;

    try {
      const response = await fetch(this.subgraphUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          variables: { token, usdt },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        console.error("V4 subgraph query errors:", result.errors);
        return null;
      }

      // Return first non-empty result
      const poolsA = result.data?.a || [];
      const poolsB = result.data?.b || [];

      if (poolsA.length > 0) return poolsA[0];
      if (poolsB.length > 0) return poolsB[0];

      return null;
    } catch (error) {
      console.error("Failed to fetch pool from V4 subgraph:", error);
      return null;
    }
  }

  computePrice(
    pool: PoolData,
    usdtAddress: string,
    usdtDecimals: number,
    tokenDecimals: number
  ): number {
    // sqrtPriceX96 is Q64.96 format: sqrtPrice = sqrt(price) * 2^96
    // price = (sqrtPriceX96 / 2^96)^2
    const sqrtPriceX96 = BigInt(pool.sqrtPriceX96);
    const Q96 = BigInt(2) ** BigInt(96);

    // Calculate raw price as a number
    // rawPrice = token1/token0 in raw (wei) units
    const sqrtPriceFloat = Number(sqrtPriceX96) / Number(Q96);
    const rawPrice = sqrtPriceFloat * sqrtPriceFloat;

    const isUsdtCurrency0 =
      pool.currency0.toLowerCase() === usdtAddress.toLowerCase();

    // Adjust for decimals
    // If USDT is currency0: rawPrice = TOKEN/USDT in raw, need to convert
    // If USDT is currency1: rawPrice = USDT/TOKEN in raw

    if (isUsdtCurrency0) {
      // rawPrice = currency1/currency0 = TOKEN/USDT (in raw units)
      // To get USDT per TOKEN: 1/rawPrice, then adjust decimals
      const decimalAdjustment = 10 ** (usdtDecimals - tokenDecimals);
      return (1 / rawPrice) * decimalAdjustment;
    } else {
      // rawPrice = currency1/currency0 = USDT/TOKEN (in raw units)
      // This IS USDT per TOKEN, just need decimal adjustment
      const decimalAdjustment = 10 ** (tokenDecimals - usdtDecimals);
      return rawPrice * decimalAdjustment;
    }
  }
}
