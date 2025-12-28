/**
 * Configuration for Uniswap UI Quote Scraper
 * All values loaded from environment variables with sensible defaults
 */

export interface ScraperConfig {
  // Scraping intervals and timeouts
  scrapeIntervalMs: number;
  uniswapTimeoutMs: number;
  maxStalenessSeconds: number;
  
  // Quote sizes to fetch
  quoteSizesUsdt: number[];
  
  // Browser settings
  headless: boolean;
  chromeArgs: string[];
  userAgent: string;
  blockResources: boolean;
  consentAutoAccept: boolean;
  
  // Server settings
  httpPort: number;
  wsPort: number;
  
  // Retry settings
  maxConsecutiveFailures: number;
  browserRestartOnFailures: number;
  
  // Token URLs
  tokens: {
    CSR: string;
    CSR25: string;
  };
}

export function loadConfig(): ScraperConfig {
  // Full ladder from $1 to $1000 per user request
  const quoteSizesStr =
    process.env.QUOTE_SIZES_USDT || "1,5,10,25,50,100,250,500,1000";
  const chromeArgsStr =
    process.env.CHROME_ARGS ||
    "--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage,--disable-gpu,--disable-software-rasterizer";

  return {
    scrapeIntervalMs: parseInt(process.env.SCRAPE_INTERVAL_MS || "10000", 10),
    uniswapTimeoutMs: parseInt(process.env.UNISWAP_TIMEOUT_MS || "30000", 10),
    maxStalenessSeconds: parseInt(
      process.env.MAX_STALENESS_SECONDS || "20",
      10
    ),

    quoteSizesUsdt: quoteSizesStr.split(",").map((s) => parseFloat(s.trim())),

    headless: process.env.HEADLESS !== "false",
    chromeArgs: chromeArgsStr.split(",").map((s) => s.trim()),
    userAgent:
      process.env.USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    blockResources: process.env.BLOCK_RESOURCES !== "false",
    consentAutoAccept: process.env.CONSENT_AUTO_ACCEPT !== "false",

    httpPort: parseInt(process.env.SCRAPER_HTTP_PORT || "3010", 10),
    wsPort: parseInt(process.env.SCRAPER_WS_PORT || "3011", 10),

    maxConsecutiveFailures: parseInt(
      process.env.MAX_CONSECUTIVE_FAILURES || "5",
      10
    ),
    browserRestartOnFailures: parseInt(
      process.env.BROWSER_RESTART_ON_FAILURES || "3",
      10
    ),

    tokens: {
      CSR: "https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0xdAC17F958D2ee523a2206206994597C13D831ec7&outputCurrency=0x75Ecb52e403C617679FBd3e77A50f9d10A842387",
      CSR25:
        "https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0xdAC17F958D2ee523a2206206994597C13D831ec7&outputCurrency=0x502E7230E142A332DFEd1095F7174834b2548982",
    },
  };
}
