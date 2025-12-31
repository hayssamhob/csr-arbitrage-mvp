import { BigNumber, constants, Contract, providers } from "ethers";
import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import { CONTRACTS, config as serviceConfig } from "./config";

// ==========================================================================
// Uniswap V4 Quote Service (Verified Mainnet Pools)
// Uses V4 Quoter quoteExactInputSingle for accurate pricing
// ==========================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";

const TOPIC_MARKET_DATA = "market.data";

// V4 Quoter ABI - quoteExactInputSingle returns quote for a single-hop swap
const QUOTER_ABI = [
  "function quoteExactInputSingle(tuple(tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) external returns (uint256 amountOut, uint256 gasEstimate)",
];

// Token definitions with decimals
const TOKENS = {
  USDT: {
    address: CONTRACTS.USDT_TOKEN,
    decimals: 6,
    symbol: "USDT",
  },
  CSR: {
    address: CONTRACTS.CSR_TOKEN,
    decimals: 18,
    symbol: "CSR",
  },
  CSR25: {
    address: CONTRACTS.CSR25_TOKEN,
    decimals: 18,
    symbol: "CSR25",
  },
};

// Sort addresses for V4 pool key (currency0 < currency1)
function sortCurrencies(tokenA: string, tokenB: string): [string, string] {
  return tokenA.toLowerCase() < tokenB.toLowerCase()
    ? [tokenA, tokenB]
    : [tokenB, tokenA];
}

const provider = new providers.JsonRpcProvider(serviceConfig.RPC_URL);
const quoter = new Contract(CONTRACTS.UNISWAP_V4_QUOTER, QUOTER_ABI, provider);
const redis = new Redis(serviceConfig.REDIS_URL);

// Pool configurations
interface PoolConfig {
  symbol: "CSR" | "CSR25";
  tokenAddress: string;
  tokenDecimals: number;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

function getPoolConfigs(): PoolConfig[] {
  return [
    {
      symbol: "CSR",
      tokenAddress: TOKENS.CSR.address,
      tokenDecimals: TOKENS.CSR.decimals,
      fee: serviceConfig.CSR_POOL_FEE_BPS ?? 3000,
      tickSpacing: serviceConfig.CSR_POOL_TICK_SPACING ?? 60,
      hooks: serviceConfig.CSR_POOL_HOOK ?? constants.AddressZero,
    },
    {
      symbol: "CSR25",
      tokenAddress: TOKENS.CSR25.address,
      tokenDecimals: TOKENS.CSR25.decimals,
      fee: serviceConfig.CSR25_POOL_FEE_BPS ?? 3000,
      tickSpacing: serviceConfig.CSR25_POOL_TICK_SPACING ?? 60,
      hooks: serviceConfig.CSR25_POOL_HOOK ?? constants.AddressZero,
    },
  ];
}

async function fetchQuote(poolConfig: PoolConfig): Promise<{
  price: number;
  amountOut: string;
  gasEstimate: string;
  ts: number;
} | null> {
  try {
    // Sort currencies for pool key
    const [currency0, currency1] = sortCurrencies(
      TOKENS.USDT.address,
      poolConfig.tokenAddress
    );
    const zeroForOne =
      currency0.toLowerCase() === TOKENS.USDT.address.toLowerCase();

    // Quote for 1 USDT input
    const amountIn = BigNumber.from(10).pow(TOKENS.USDT.decimals); // 1 USDT

    const poolKey = {
      currency0,
      currency1,
      fee: poolConfig.fee,
      tickSpacing: poolConfig.tickSpacing,
      hooks: poolConfig.hooks,
    };

    const params = {
      poolKey,
      zeroForOne,
      exactAmount: amountIn,
      hookData: "0x",
    };

    console.log(
      `[Quote] Querying ${poolConfig.symbol}: zeroForOne=${zeroForOne}, fee=${poolConfig.fee}`
    );

    const result = await quoter.callStatic.quoteExactInputSingle(params);
    const amountOut: BigNumber = result.amountOut ?? result[0];
    const gasEstimate: BigNumber =
      result.gasEstimate ?? result[1] ?? BigNumber.from(0);

    if (!amountOut || amountOut.isZero()) {
      console.warn(`[Quote] Quoter returned zero for ${poolConfig.symbol}`);
      return null;
    }

    // Price = amountIn (USDT) / amountOut (token)
    // 1 USDT = amountOut tokens => 1 token = 1/amountOut USDT
    const tokenAmount =
      amountOut.toNumber() / Math.pow(10, poolConfig.tokenDecimals);
    const price = 1 / tokenAmount; // Price per token in USDT

    return {
      price,
      amountOut: amountOut.toString(),
      gasEstimate: gasEstimate.toString(),
      ts: Date.now(),
    };
  } catch (err: any) {
    console.error(
      `[Quote] quoteExactInputSingle failed for ${poolConfig.symbol}: ${err.message}`
    );
    return null;
  }
}

async function publishTick(
  symbol: "CSR" | "CSR25",
  data: { price: number; amountOut: string; gasEstimate: string }
): Promise<void> {
  const tick = {
    type: "dex_quote",
    eventId: uuidv4(),
    symbol: symbol.toLowerCase() === "csr" ? "csr/usdt" : "csr25/usdt",
    venue: "uniswap_v4",
    source: "uniswap_v4",
    ts: new Date().toISOString(),
    effective_price_usdt: data.price,
    amount_in: 1,
    amount_out: 1 / data.price,
    gas_estimate_usdt: Number(data.gasEstimate) * 40e-9 * 3000,
    route: "v4_pool",
  };

  try {
    await redis.xadd(TOPIC_MARKET_DATA, "*", "payload", JSON.stringify(tick));
    console.log(`[Quote] ${symbol} price: $${data.price.toFixed(6)}`);
  } catch (err) {
    console.error(`[Quote] Redis publish error:`, err);
  }
}

let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 5;

async function poll(): Promise<void> {
  const poolConfigs = getPoolConfigs();

  if (poolConfigs.length === 0) {
    console.warn(`[Quote] No pool IDs configured - skipping poll`);
    setTimeout(poll, serviceConfig.POLL_INTERVAL_MS);
    return;
  }

  try {
    const results = await Promise.all(
      poolConfigs.map(async (cfg) => {
        const quote = await fetchQuote(cfg);
        return { cfg, quote };
      })
    );

    let anySuccess = false;
    for (const { cfg, quote } of results) {
      if (quote) {
        await publishTick(cfg.symbol, quote);
        anySuccess = true;
      }
    }

    if (anySuccess) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
      if (consecutiveFailures <= MAX_CONSECUTIVE_FAILURES) {
        console.warn(
          `[Quote] No quotes retrieved (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`
        );
      }
    }
  } catch (err) {
    console.error(`[Quote] Poll error:`, (err as any).message);
    consecutiveFailures++;
  } finally {
    setTimeout(poll, serviceConfig.POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  console.log(`[Quote] ========================================`);
  console.log(`[Quote] Uniswap V4 Quote Service Starting`);
  console.log(`[Quote] ========================================`);
  console.log(`[Quote] RPC: ${serviceConfig.RPC_URL.slice(0, 40)}...`);
  console.log(`[Quote] PoolManager: ${CONTRACTS.UNISWAP_V4_MANAGER}`);
  console.log(`[Quote] Quoter: ${CONTRACTS.UNISWAP_V4_QUOTER}`);

  try {
    const block = await provider.getBlockNumber();
    console.log(`[Quote] RPC connected. Block: ${block}`);
  } catch (err: any) {
    console.error(`[Quote] RPC connectivity failed: ${err.message}`);
    process.exit(1);
  }

  try {
    const code = await provider.getCode(CONTRACTS.UNISWAP_V4_MANAGER);
    if (code === "0x") {
      console.error(`[Quote] FATAL: No contract at PoolManager address!`);
      process.exit(1);
    }
    console.log(`[Quote] PoolManager contract verified (${code.length} bytes)`);
  } catch (err: any) {
    console.error(`[Quote] Failed to verify PoolManager: ${err.message}`);
  }

  poll();
}

main().catch((err) => {
  console.error(`[Quote] Fatal:`, err);
  process.exit(1);
});
