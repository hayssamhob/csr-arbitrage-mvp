#!/usr/bin/env ts-node

import axios from 'axios';

// LBank API endpoints to try
const ENDPOINTS = [
  'https://api.lbkex.com/v1/currencyPairs.do',
  'https://api.lbkex.com/v2/currencyPairs.do',
  'https://api.lbkex.net/v1/currencyPairs.do',
  'https://api.lbkex.net/v2/currencyPairs.do',
];

async function fetchSymbols(endpoint: string): Promise<void> {
  try {
    console.log(`\n=== Testing ${endpoint} ===`);
    const response = await axios.get(endpoint, { timeout: 5000 });
    const data = response.data;
    
    console.log('Response structure:', typeof data);
    
    let symbols: string[] = [];
    if (Array.isArray(data)) {
      symbols = data;
    } else if (data?.data && Array.isArray(data.data)) {
      symbols = data.data;
    } else if (data?.result === 'true' && data?.data && Array.isArray(data.data)) {
      symbols = data.data;
    } else {
      console.log('Unexpected response format:', JSON.stringify(data, null, 2));
      return;
    }
    
    console.log(`Found ${symbols.length} total symbols`);
    
    // Find CSR-related symbols
    const csrSymbols = symbols.filter(s => /csr/i.test(s));
    console.log('\nCSR-related symbols:', csrSymbols);
    
    // Find USDT symbols containing CSR
    const csrUsdtSymbols = symbols.filter(s => /csr.*usdt|usdt.*csr/i.test(s));
    console.log('CSR/USDT symbols:', csrUsdtSymbols);
    
    // Show first 20 USDT symbols for reference
    const usdtSymbols = symbols.filter(s => /usdt/i.test(s)).slice(0, 20);
    console.log('\nFirst 20 USDT symbols:', usdtSymbols);
    
    // If we found CSR/USDT, try to get ticker
    if (csrUsdtSymbols.length > 0) {
      const symbol = csrUsdtSymbols[0];
      console.log(`\n=== Testing ticker for ${symbol} ===`);
      try {
        const tickerUrl = endpoint.replace('currencyPairs', 'ticker') + `?symbol=${symbol}`;
        const tickerResponse = await axios.get(tickerUrl, { timeout: 5000 });
        console.log(`Ticker for ${symbol}:`, JSON.stringify(tickerResponse.data, null, 2));
      } catch (err) {
        console.log(`Ticker failed for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }
    
  } catch (error) {
    console.log(`Failed to fetch ${endpoint}:`, error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  console.log('=== LBank Symbol Discovery ===');
  console.log('Finding exact CSR/USDT symbol identifier...\n');
  
  for (const endpoint of ENDPOINTS) {
    await fetchSymbols(endpoint);
  }
  
  console.log('\n=== Summary ===');
  console.log('Use the exact symbol string from the API results for WS subscription.');
  console.log('WS subscription payload should use the same case/format as REST API.');
}

main().catch(console.error);
