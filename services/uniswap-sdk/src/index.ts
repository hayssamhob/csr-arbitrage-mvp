/**
 * Uniswap SDK-based Price Provider
 * 
 * Replaces the UI scraper with direct RPC calls to Uniswap V3 pools
 * using viem for reliable, fast price data.
 */

import * as dotenv from 'dotenv';
import express from 'express';
import { createPublicClient, formatUnits, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';

dotenv.config();

const app = express();
const PORT = process.env.UNISWAP_SDK_PORT || 3012;

// Token configurations
const TOKENS = {
  USDT: {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as `0x${string}`,
    decimals: 6,
    symbol: 'USDT'
  },
  WETH: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as `0x${string}`,
    decimals: 18,
    symbol: 'WETH'
  },
  CSR: {
    address: '0x75Ecb52e403C617679FBd3e77A50f9d10A842387' as `0x${string}`,
    decimals: 18,
    symbol: 'CSR'
  },
  CSR25: {
    address: '0x502E7230E142A332DFEd1095F7174834b2548982' as `0x${string}`,
    decimals: 18,
    symbol: 'CSR25'
  }
};

// Uniswap V3 Quoter V2 contract (supports multi-hop)
const QUOTER_V2_ADDRESS = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e' as `0x${string}`;

// Uniswap V3 Quoter V2 ABI for multi-hop quoting
const QUOTER_V2_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)'
]);

// Create viem client
const RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
const client = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL)
});

// Fee tiers to try (in basis points * 100)
const FEE_TIERS = [500, 3000, 10000]; // 0.05%, 0.3%, 1%

interface QuoteResult {
  market: string;
  inputToken: string;
  outputToken: string;
  amountInUSDT: number;
  amountOutToken: number;
  price_usdt_per_token: number;
  price_token_per_usdt: number;
  gasEstimate: number | null;
  feeTier: number;
  ts: number;
  valid: boolean;
  reason: string | null;
  source: string;
}

// Cache for quotes
const quoteCache: Map<string, { data: QuoteResult; timestamp: number }> = new Map();
const CACHE_TTL_MS = 5000; // 5 seconds

// Encode a multi-hop path for Uniswap V3 (token, fee, token, fee, token)
function encodePath(tokens: `0x${string}`[], fees: number[]): `0x${string}` {
  if (tokens.length !== fees.length + 1) {
    throw new Error('tokens/fees length mismatch');
  }
  
  let path = tokens[0].toLowerCase().slice(2); // Remove 0x prefix
  for (let i = 0; i < fees.length; i++) {
    // Fee is 3 bytes (24 bits)
    path += fees[i].toString(16).padStart(6, '0');
    path += tokens[i + 1].toLowerCase().slice(2);
  }
  return `0x${path}` as `0x${string}`;
}

async function getQuoteForSize(
  tokenSymbol: 'CSR' | 'CSR25',
  amountUSDT: number
): Promise<QuoteResult> {
  const cacheKey = `${tokenSymbol}_${amountUSDT}`;
  const cached = quoteCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const token = TOKENS[tokenSymbol];
  const amountIn = BigInt(Math.floor(amountUSDT * 10 ** TOKENS.USDT.decimals));

  // Try multi-hop routes: USDT -> WETH -> CSR/CSR25
  // Fee tier combinations to try
  const routeCombinations = [
    { fee1: 500, fee2: 3000 },   // 0.05% USDT/WETH, 0.3% WETH/CSR
    { fee1: 500, fee2: 10000 },  // 0.05% USDT/WETH, 1% WETH/CSR
    { fee1: 3000, fee2: 3000 },  // 0.3% USDT/WETH, 0.3% WETH/CSR
    { fee1: 3000, fee2: 10000 }, // 0.3% USDT/WETH, 1% WETH/CSR
  ];

  for (const { fee1, fee2 } of routeCombinations) {
    try {
      // Encode path: USDT -> WETH -> CSR/CSR25
      const path = encodePath(
        [TOKENS.USDT.address, TOKENS.WETH.address, token.address],
        [fee1, fee2]
      );
      
      console.log(`Trying ${tokenSymbol} multi-hop: USDT->${fee1/10000}%->WETH->${fee2/10000}%->${tokenSymbol}`);
      
      const result = await client.simulateContract({
        address: QUOTER_V2_ADDRESS,
        abi: QUOTER_V2_ABI,
        functionName: 'quoteExactInput',
        args: [path, amountIn]
      });

      const [amountOut] = result.result as [bigint, bigint[], number[], bigint];
      const amountOutFloat = parseFloat(formatUnits(amountOut, token.decimals));
      
      if (amountOutFloat > 0) {
        console.log(`Success! ${amountUSDT} USDT -> ${amountOutFloat} ${tokenSymbol}`);
        
        const quote: QuoteResult = {
          market: `${tokenSymbol}_USDT`,
          inputToken: 'USDT',
          outputToken: tokenSymbol,
          amountInUSDT: amountUSDT,
          amountOutToken: amountOutFloat,
          price_usdt_per_token: amountUSDT / amountOutFloat,
          price_token_per_usdt: amountOutFloat / amountUSDT,
          gasEstimate: null,
          feeTier: fee1 + fee2, // Combined fees
          ts: Date.now(),
          valid: true,
          reason: null,
          source: 'uniswap_sdk_multihop'
        };

        quoteCache.set(cacheKey, { data: quote, timestamp: Date.now() });
        return quote;
      }
    } catch (err: any) {
      console.log(`Multi-hop ${fee1}/${fee2} failed for ${tokenSymbol}: ${err.message?.substring(0, 80)}`);
      continue;
    }
  }

  console.log(`All routes failed for ${tokenSymbol} at ${amountUSDT} USDT`);
  
  return {
    market: `${tokenSymbol}_USDT`,
    inputToken: 'USDT',
    outputToken: tokenSymbol,
    amountInUSDT: amountUSDT,
    amountOutToken: 0,
    price_usdt_per_token: 0,
    price_token_per_usdt: 0,
    gasEstimate: null,
    feeTier: 0,
    ts: Date.now(),
    valid: false,
    reason: 'no_liquidity_route_found',
    source: 'uniswap_sdk_multihop'
  };
}

// Quote sizes to fetch
const QUOTE_SIZES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

async function fetchAllQuotes(): Promise<QuoteResult[]> {
  const quotes: QuoteResult[] = [];
  
  for (const token of ['CSR', 'CSR25'] as const) {
    for (const size of QUOTE_SIZES) {
      try {
        const quote = await getQuoteForSize(token, size);
        quotes.push(quote);
      } catch (err: any) {
        console.error(`Error fetching quote for ${token} at ${size} USDT:`, err.message);
        quotes.push({
          market: `${token}_USDT`,
          inputToken: 'USDT',
          outputToken: token,
          amountInUSDT: size,
          amountOutToken: 0,
          price_usdt_per_token: 0,
          price_token_per_usdt: 0,
          gasEstimate: null,
          feeTier: 0,
          ts: Date.now(),
          valid: false,
          reason: err.message,
          source: 'uniswap_sdk'
        });
      }
    }
  }
  
  return quotes;
}

// Store latest quotes
let latestQuotes: QuoteResult[] = [];
let lastFetchTime = 0;

// Background refresh
async function refreshQuotes() {
  try {
    console.log('Refreshing Uniswap quotes via SDK...');
    latestQuotes = await fetchAllQuotes();
    lastFetchTime = Date.now();
    
    const validCount = latestQuotes.filter(q => q.valid).length;
    console.log(`Fetched ${latestQuotes.length} quotes, ${validCount} valid`);
  } catch (err: any) {
    console.error('Error refreshing quotes:', err.message);
  }
}

// API Endpoints
app.get('/health', (req, res) => {
  const validQuotes = latestQuotes.filter(q => q.valid).length;
  res.json({
    status: validQuotes > 0 ? 'healthy' : 'degraded',
    validQuotes,
    totalQuotes: latestQuotes.length,
    lastFetchTime: new Date(lastFetchTime).toISOString(),
    rpcUrl: RPC_URL.replace(/\/[^/]+$/, '/***') // Mask API key
  });
});

app.get('/quotes', (req, res) => {
  res.json({
    source: 'uniswap_sdk',
    chainId: 1,
    quotes: latestQuotes,
    meta: {
      lastFetch: lastFetchTime,
      validCount: latestQuotes.filter(q => q.valid).length,
      totalCount: latestQuotes.length
    }
  });
});

app.get('/quote/:token/:size', async (req, res) => {
  const token = req.params.token.toUpperCase() as 'CSR' | 'CSR25';
  const size = parseFloat(req.params.size);
  
  if (token !== 'CSR' && token !== 'CSR25') {
    return res.status(400).json({ error: 'Invalid token. Use CSR or CSR25' });
  }
  
  if (isNaN(size) || size <= 0) {
    return res.status(400).json({ error: 'Invalid size' });
  }
  
  try {
    const quote = await getQuoteForSize(token, size);
    res.json(quote);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Uniswap SDK service running on port ${PORT}`);
  console.log(`RPC URL: ${RPC_URL.replace(/\/[^/]+$/, '/***')}`);
  
  // Initial fetch
  refreshQuotes();
  
  // Refresh every 10 seconds
  setInterval(refreshQuotes, 10000);
});
