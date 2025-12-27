import { ethers } from 'ethers';
import { TokenConfig } from './config';

// ============================================================================
// Uniswap v4 Pool State Reader
// Reads pool state directly from Uniswap v4 using PoolManager
// ============================================================================

// PoolManager ABI for reading pool states
const POOL_MANAGER_ABI = [
  'function getLiquidity(bytes32 poolId) external view returns (uint128)',
  'function getPoolState(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint16 protocolFee, uint16 lpFee)'
];

export class V4PoolReader {
  private provider: ethers.providers.JsonRpcProvider;
  private poolManagerContract: ethers.Contract;
  
  constructor(provider: ethers.providers.JsonRpcProvider, poolManagerAddress: string) {
    this.provider = provider;
    this.poolManagerContract = new ethers.Contract(poolManagerAddress, POOL_MANAGER_ABI, provider);
  }

  async readPoolState(
    poolId: string,
    tokenIn: TokenConfig,
    tokenOut: TokenConfig
  ): Promise<{
    price: number;
    exists: boolean;
    liquidity: string;
    sqrtPriceX96: string;
  }> {
    try {
      // Get pool state from PoolManager
      const poolState = await this.poolManagerContract.getPoolState(poolId);
      const liquidity = await this.poolManagerContract.getLiquidity(poolId);
      
      const sqrtPriceX96 = poolState.sqrtPriceX96;
      
      // Calculate price from sqrtPriceX96
      // price = (sqrtPriceX96 / 2^96)^2
      const price = (Number(sqrtPriceX96) / (2 ** 96)) ** 2;
      
      // Determine token order and adjust price
      // We need to determine which token is token0/token1 in the pool
      const isToken0InPool = tokenIn.address.toLowerCase() < tokenOut.address.toLowerCase();
      
      let effectivePriceUsdtPerToken: number;
      
      if (isToken0InPool) {
        // token0 is USDT, token1 is TOKEN
        // price is token1/token0, so we need 1/price
        effectivePriceUsdtPerToken = 1 / price;
      } else {
        // token0 is TOKEN, token1 is USDT
        // price is token1/token0 = USDT/TOKEN, which is what we want
        effectivePriceUsdtPerToken = price;
      }
      
      // Apply decimal adjustments
      const decimalAdjustment = 10 ** (tokenIn.decimals - tokenOut.decimals);
      effectivePriceUsdtPerToken *= decimalAdjustment;
      
      return {
        price: effectivePriceUsdtPerToken,
        exists: true,
        liquidity: liquidity.toString(),
        sqrtPriceX96: sqrtPriceX96.toString()
      };
      
    } catch (error) {
      console.error('Failed to read v4 pool state:', error);
      return {
        price: 0,
        exists: false,
        liquidity: '0',
        sqrtPriceX96: '0'
      };
    }
  }
}
