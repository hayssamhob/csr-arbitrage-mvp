// ============================================================================
// Uniswap V4 Quote Service Configuration
// Simplified configuration - uses environment variables directly
// ============================================================================

export interface Config {
  REDIS_URL: string;
  RPC_URL: string;
  HTTP_PORT: number;
  CSR_POOL_ID: string;
  CSR25_POOL_ID: string;
  POLL_INTERVAL_MS: number;
  LOG_LEVEL: string;
}

export function loadConfig(): Config {
  return {
    REDIS_URL: process.env.REDIS_URL || "redis://localhost:6379",
    RPC_URL: process.env.RPC_URL || "https://eth.llamarpc.com",
    HTTP_PORT: parseInt(process.env.HTTP_PORT || "3002", 10),
    CSR_POOL_ID: process.env.CSR_POOL_ID || "",
    CSR25_POOL_ID: process.env.CSR25_POOL_ID || "",
    POLL_INTERVAL_MS: parseInt(process.env.POLL_INTERVAL_MS || "5000", 10),
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
  };
}
