import { TokenConfig } from './config';

// ============================================================================
// Uniswap v4 Subgraph Reader (via The Graph Gateway)
// Fetches pool data from Uniswap v4 subgraph using API key authentication
// ============================================================================

interface PoolData {
  id: string;
  feeTier: string;
  sqrtPrice: string;
  token0: {
    id: string;
    symbol: string;
    decimals: string;
  };
  token1: {
    id: string;
    symbol: string;
    decimals: string;
  };
  token0Price: string;
  token1Price: string;
  liquidity: string;
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
          feeTier
          sqrtPrice
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
          token0Price
          token1Price
          liquidity
        }
      }
    `;

    try {
      const response = await fetch(this.subgraphUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { poolId },
        }),
      });

      const result = await response.json();

      if (result.errors) {
        console.error('Subgraph query errors:', result.errors);
        return null;
      }

      return result.data.pool || null;
    } catch (error) {
      console.error('Failed to fetch pool by ID:', error);
      return null;
    }
  }

  async discoverPoolByTokens(token0: TokenConfig, token1: TokenConfig): Promise<PoolData | null> {
    // Try both token orderings
    const queries = [
      {
        query: `
          query findPool($token0: String!, $token1: String!) {
            pools(where: { token0: $token0, token1: $token1 }, orderBy: liquidity, orderDirection: desc, first: 1) {
              id
              feeTier
              sqrtPrice
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
              token0Price
              token1Price
              liquidity
            }
          }
        `,
        variables: { token0: token0.address.toLowerCase(), token1: token1.address.toLowerCase() },
      },
      {
        query: `
          query findPool($token0: String!, $token1: String!) {
            pools(where: { token0: $token0, token1: $token1 }, orderBy: liquidity, orderDirection: desc, first: 1) {
              id
              feeTier
              sqrtPrice
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
              token0Price
              token1Price
              liquidity
            }
          }
        `,
        variables: { token0: token1.address.toLowerCase(), token1: token0.address.toLowerCase() },
      },
    ];

    for (const { query, variables } of queries) {
      try {
        const response = await fetch(this.subgraphUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query, variables }),
        });

        const result = await response.json();

        if (result.errors) {
          console.error('Subgraph query errors:', result.errors);
          continue;
        }

        const pools = result.data.pools || [];
        if (pools.length > 0 && pools[0].liquidity !== '0') {
          return pools[0];
        }
      } catch (error) {
        console.error('Failed to discover pool:', error);
        continue;
      }
    }

    return null;
  }

  computeUsdtPrice(pool: PoolData, usdtToken: TokenConfig, targetToken: TokenConfig): number {
    const isUsdtToken0 = pool.token0.id.toLowerCase() === usdtToken.address.toLowerCase();
    
    if (isUsdtToken0) {
      // USDT is token0, target is token1
      if (pool.token1.id.toLowerCase() === targetToken.address.toLowerCase()) {
        // Direct price: token0Price is USDT per token1
        return parseFloat(pool.token0Price);
      }
    } else {
      // USDT is token1, target is token0
      if (pool.token0.id.toLowerCase() === targetToken.address.toLowerCase()) {
        // Direct price: token1Price is USDT per token0
        return parseFloat(pool.token1Price);
      }
    }

    // Fallback: compute from sqrtPrice if needed
    const sqrtPrice = parseFloat(pool.sqrtPrice);
    const price = (sqrtPrice / (2 ** 96)) ** 2;
    
    // Apply decimal adjustments
    const decimalAdjustment = 10 ** (usdtToken.decimals - targetToken.decimals);
    
    if (isUsdtToken0) {
      // USDT is token0, price is token1/token0, so we need 1/price
      return (1 / price) * decimalAdjustment;
    } else {
      // USDT is token1, price is token1/token0 = USDT/TOKEN
      return price * decimalAdjustment;
    }
  }
}
