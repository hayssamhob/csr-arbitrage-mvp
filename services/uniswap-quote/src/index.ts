import { ethers } from 'ethers';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { config, CONTRACTS } from './config';
import { createPublicClient, http, parseAbi, formatUnits } from 'viem';
import { mainnet } from 'viem/chains';

// ============================================================================
// Uniswap V4 Quote Service (Redis Publisher)
// Fetches prices for CSR and CSR25 from Uniswap V4 pools
// Publishes 'dex_quote' messages to Redis 'market.data' stream
// ============================================================

const TOPIC_MARKET_DATA = 'market.data';

// Minimal ABIs for Uniswap V4
const POOL_MANAGER_ABI = parseAbi([
    'function getSlot0(bytes32 poolId) external view returns (uint160 sqrtPriceX96, int24 tick, uint16 protocolFee, uint24 lpFee)'
]);

const QUOTER_ABI = parseAbi([
    'struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }',
    'function quoteExactInputSingle((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, bool zeroForOne, uint128 amountIn, bytes hookData) external returns (uint128 amountOut, uint256 gasEstimate)'
]);

const redis = new Redis(config.REDIS_URL);
const viemClient = createPublicClient({
    chain: mainnet,
    transport: http(config.RPC_URL)
});

/**
 * Fetch V4 Price using PoolManager (Slot0) as baseline
 */
async function getV4MidPrice(poolId: string): Promise<number | null> {
    try {
        const [sqrtPriceX96] = await viemClient.readContract({
            address: CONTRACTS.UNISWAP_V4_MANAGER as `0x${string}`,
            abi: POOL_MANAGER_ABI,
            functionName: 'getSlot0',
            args: [poolId as `0x${string}`]
        });

        // Price = (sqrtPriceX96 / 2^96)^2
        const price = Number(sqrtPriceX96) / (2 ** 96);
        const actualPrice = price * price;

        // Note: This price depends on token0/token1 order. 
        // For our pools (Token/WETH or Token/USDT), we need to handle decimals.
        return actualPrice;
    } catch (err) {
        console.error(`[V4-Price] Error fetching Slot0 for ${poolId}:`, err);
        return null;
    }
}

async function getQuote(symbol: 'CSR' | 'CSR25', amountUsdt: number) {
    const tokenAddress = symbol === 'CSR' ? CONTRACTS.CSR_TOKEN : CONTRACTS.CSR25_TOKEN;
    const poolId = symbol === 'CSR' ? config.CSR_POOL_ID : config.CSR25_POOL_ID;

    if (!poolId) {
        console.warn(`[Quote] No PoolID configured for ${symbol}`);
        return null;
    }

    try {
        // For MVP, we use the MidPrice from Slot0 as a reliable indicator
        // if the Quoter is not yet fully available for these specific pools
        const midPrice = await getV4MidPrice(poolId);

        if (!midPrice) return null;

        // Adjusting for decimals (assuming CSR/CSR25 have 18, and we might be paired with WETH/USDT)
        // This logic should be refined based on actual V4 pool compositions
        // For now, we return the normalized mid price

        return {
            price: midPrice,
            amountOut: (amountUsdt / midPrice).toString(),
            gasEstimate: "150000", // Generic V4 gas estimate
            ts: Date.now()
        };
    } catch (e: any) {
        console.error(`[Quote] V4 fetch failed for ${symbol}:`, e.message);
    }
    return null;
}

async function publishTick(symbol: string, data: any) {
    const tick = {
        type: 'dex_quote',
        eventId: uuidv4(),
        symbol: symbol.toLowerCase() === 'csr' ? 'csr/usdt' : 'csr25/usdt',
        venue: 'uniswap_v4',
        source: 'uniswap_v4',
        ts: new Date().toISOString(),
        effective_price_usdt: data.price,
        amount_in: 100,
        amount_out: data.amountOut,
        gas_estimate_usdt: 0.5,
        route: 'v4_pool'
    };

    try {
        await redis.xadd(TOPIC_MARKET_DATA, '*', 'payload', JSON.stringify(tick));
        console.log(`[Quote] Published V4 ${symbol} price: ${data.price.toFixed(6)}`);
    } catch (err) {
        console.error(`[Quote] Redis publish error:`, err);
    }
}

async function main() {
    console.log(`Uniswap V4 Quote Service starting...`);
    console.log(`RPC: ${config.RPC_URL.slice(0, 30)}...`);
    console.log(`PoolManager: ${CONTRACTS.UNISWAP_V4_MANAGER}`);

    const poll = async () => {
        try {
            const [csrQuote, csr25Quote] = await Promise.all([
                getQuote('CSR', 100),
                getQuote('CSR25', 100)
            ]);

            if (csrQuote) await publishTick('csr', csrQuote);
            if (csr25Quote) await publishTick('csr25', csr25Quote);

        } catch (err) {
            console.error(`[Quote] Error in poll loop:`, err);
        }
        setTimeout(poll, config.POLL_INTERVAL_MS);
    };

    poll();
}

main().catch(console.error);
