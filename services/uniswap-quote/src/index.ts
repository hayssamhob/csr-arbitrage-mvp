import { ethers } from 'ethers';
import Redis from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { config, CONTRACTS } from './config';

// ============================================================================
// Uniswap Quote Service (Redis Publisher)
// Fetches prices for CSR and CSR25 from Uniswap V3 pools
// Publishes 'market.tick' messages to Redis 'market.data' stream
// ============================================================================

const TOPIC_MARKET_DATA = 'market.data';

// Minimal ABI for QuoterV2
const QUOTER_V2_ABI = [
    'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
];

const redis = new Redis(config.REDIS_URL);
const provider = new ethers.providers.JsonRpcProvider(config.RPC_URL);
const quoter = new ethers.Contract(CONTRACTS.UNISWAP_QUOTER, QUOTER_V2_ABI, provider);

// Fee tiers (500 = 0.05%, 3000 = 0.3%, 10000 = 1%)
const FEE_TIERS = [500, 3000, 10000];

/**
 * Encode Uniswap V3 path (tokenAddress + fee + tokenAddress)
 */
function encodePath(tokens: string[], fees: number[]): string {
    if (tokens.length !== fees.length + 1) {
        throw new Error('tokens/fees length mismatch');
    }
    let path = tokens[0];
    for (let i = 0; i < fees.length; i++) {
        const feeHex = fees[i].toString(16).padStart(6, '0');
        path += feeHex + tokens[i + 1].slice(2);
    }
    return path.toLowerCase();
}

async function getQuote(symbol: 'CSR' | 'CSR25', amountUsdt: number) {
    const tokenAddress = symbol === 'CSR' ? CONTRACTS.CSR_TOKEN : CONTRACTS.CSR25_TOKEN;
    const amountIn = ethers.utils.parseUnits(amountUsdt.toString(), 6); // USDT has 6 decimals

    // Try direct route first: USDT -> [fee] -> Token
    // If no direct pool, try multi-hop: USDT -> [fee] -> WETH -> [fee] -> Token
    const routes = [
        // Multi-hop (more likely for CSR/CSR25)
        { path: [CONTRACTS.USDT_TOKEN, CONTRACTS.WETH_TOKEN, tokenAddress], fees: [500, 3000] },
        { path: [CONTRACTS.USDT_TOKEN, CONTRACTS.WETH_TOKEN, tokenAddress], fees: [500, 10000] },
        // Direct
        { path: [CONTRACTS.USDT_TOKEN, tokenAddress], fees: [3000] },
        { path: [CONTRACTS.USDT_TOKEN, tokenAddress], fees: [10000] },
    ];

    for (const route of routes) {
        try {
            const pathHex = encodePath(route.path, route.fees);
            const [amountOut, , , gasEstimate] = await quoter.callStatic.quoteExactInput(pathHex, amountIn);

            const price = amountUsdt / parseFloat(ethers.utils.formatUnits(amountOut, 18));

            return {
                price,
                amountOut: ethers.utils.formatUnits(amountOut, 18),
                gasEstimate: gasEstimate.toString(),
                route: route.path.join('->'),
                ts: Date.now()
            };
        } catch (e) {
            // Continue to next route
        }
    }
    return null;
}

async function publishTick(symbol: string, data: any) {
    const tick = {
        type: 'dex_quote',
        eventId: uuidv4(),
        symbol: symbol.toLowerCase() === 'csr' ? 'csr/usdt' : 'csr25/usdt',
        venue: 'uniswap_v3',
        source: 'uniswap_v4',
        ts: new Date().toISOString(),
        effective_price_usdt: data.price,
        amount_in: 100, // Matching the poll amount
        amount_out: data.amountOut,
        gas_estimate_usdt: parseFloat(data.gasEstimate) / 1e18 * 2500, // Very rough USD estimate
        route: data.route
    };

    try {
        await redis.xadd(TOPIC_MARKET_DATA, '*', 'data', JSON.stringify(tick));
        console.log(`[Quote] Published ${symbol} price: ${data.price.toFixed(6)}`);
    } catch (err) {
        console.error(`[Quote] Redis publish error:`, err);
    }
}

async function main() {
    console.log(`Uniswap Quote Service starting...`);
    console.log(`RPC: ${config.RPC_URL.slice(0, 30)}...`);
    console.log(`Redis: ${config.REDIS_URL}`);

    const poll = async () => {
        try {
            // Fetch both prices in parallel
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
