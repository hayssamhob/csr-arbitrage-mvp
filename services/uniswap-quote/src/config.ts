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
  PRIVATE_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  CEX_SECRETS_KEY: string;
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
    PRIVATE_KEY: process.env.PRIVATE_KEY || "",
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    CEX_SECRETS_KEY: process.env.CEX_SECRETS_KEY || "",
  };
}
