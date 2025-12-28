import { TokenConfig } from './config';

// ============================================================================
// Uniswap v4 Subgraph Reader (via The Graph Gateway)
// Fetches pool data from Uniswap v4 subgraph using API key authentication
// ============================================================================

interface PoolData {
  id: string;
  poolId: string;
  fee: string;
  sqrtPriceX96: string;
  tick: string;
  currency0: string;
  currency1: string;
  tickSpacing: string;
}

export class V4SubgraphGatewayReader {
  private subgraphUrl: string;

  constructor(subgraphUrl: string) {
    this.subgraphUrl = subgraphUrl;
  }

  async fetchPoolById(poolId: string): Promise<PoolData | null> {
    const query = `
      query getPool($poolId: ID!) {
        pool(id: $poolId) {
          id
          poolId
          fee
          sqrtPriceX96
          tick
          currency0
          currency1
          tickSpacing
        }
      }
    `;

    try {
      const response = await fetch(this.subgraphUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { poolId },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        console.error("Subgraph query errors:", result.errors);
        return null;
      }

      return result.data.pool || null;
    } catch (error) {
      console.error("Failed to fetch pool by ID:", error);
      return null;
    }
  }

  async discoverPoolByTokens(
    token0: TokenConfig,
    token1: TokenConfig
  ): Promise<PoolData | null> {
    // Try both token orderings
    const queries = [
      {
        query: `
          query findPool($token0: String!, $token1: String!) {
            pools(where: { token0: $token0, token1: $token1 }, orderBy: liquidity, orderDirection: desc, first: 1) {
              id
              feeTier
              sqrtPrice
              tick
              token0 {
                id
                symbol
                decimals
              }
              token1 {
                id
                symbol
                decimals
              }
              liquidity
            }
          }
        `,
        variables: {
          token0: token0.address.toLowerCase(),
          token1: token1.address.toLowerCase(),
        },
      },
      {
        query: `
          query findPool($token0: String!, $token1: String!) {
            pools(where: { token0: $token0, token1: $token1 }, orderBy: liquidity, orderDirection: desc, first: 1) {
              id
              feeTier
              sqrtPrice
              tick
              token0 {
                id
                symbol
                decimals
              }
              token1 {
                id
                symbol
                decimals
              }
              liquidity
            }
          }
        `,
        variables: {
          token0: token1.address.toLowerCase(),
          token1: token0.address.toLowerCase(),
        },
      },
    ];

    for (const { query, variables } of queries) {
      try {
        const response = await fetch(this.subgraphUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query, variables }),
        });

        const result = await response.json();

        if (result.errors) {
          console.error("Subgraph query errors:", result.errors);
          continue;
        }

        const pools = result.data.pools || [];
        if (pools.length > 0 && pools[0].liquidity !== "0") {
          return pools[0];
        }
      } catch (error) {
        console.error("Failed to discover pool:", error);
        continue;
      }
    }

    return null;
  }

  computeUsdtPrice(
    pool: PoolData,
    usdtToken: TokenConfig,
    targetToken: TokenConfig
  ): number {
    const isUsdtToken0 =
      pool.token0.id.toLowerCase() === usdtToken.address.toLowerCase();

    // Compute price from sqrtPrice (V4 doesn't have token0Price/token1Price)
    // sqrtPrice is Q64.96 format: sqrtPrice = sqrt(price) * 2^96
    const sqrtPrice = parseFloat(pool.sqrtPrice);
    const rawPrice = (sqrtPrice / 2 ** 96) ** 2;

    // Get decimals
    const token0Decimals = parseInt(pool.token0.decimals);
    const token1Decimals = parseInt(pool.token1.decimals);

    // rawPrice = token1/token0 in raw units
    // Adjust for decimals: price in human units = rawPrice * 10^(token0Decimals - token1Decimals)
    const decimalAdjustment = 10 ** (token0Decimals - token1Decimals);
    const adjustedPrice = rawPrice * decimalAdjustment;

    if (isUsdtToken0) {
      // USDT is token0, so adjustedPrice = TARGET/USDT
      // We want USDT per TARGET, so return 1/adjustedPrice
      return 1 / adjustedPrice;
    } else {
      // USDT is token1, so adjustedPrice = USDT/TARGET
      // We want USDT per TARGET, so return adjustedPrice
      return adjustedPrice;
    }
  }
}
