import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

/**
 * Configuration Schema using Zod for strict validation
 * Fails fast if critical production keys are missing.
 */
const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HTTP_PORT: z.coerce.number().default(3002),

  // Blockchain Access
  RPC_URL: z.string().url().default('https://mainnet.infura.io/v3/4030c256a99c4a3d91b7c1075e5bffcb'),
  CHAIN_ID: z.coerce.number().default(1),

  // Execution Wallet (Multi-tenant: fetched per-user, but this is fallback)
  PRIVATE_KEY: z.string().optional(),

  // Flashbots & Privacy
  FLASHBOTS_RELAY_URL: z.string().url().default('https://relay.flashbots.net'),
  ENABLE_STEALTH_MODE: z.coerce.boolean().default(true),

  // Safety Limits
  MAX_GAS_PRICE_GWEI: z.coerce.number().default(100), // Abort if gas > 100 gwei
  MAX_SLIPPAGE_PERCENT: z.coerce.number().default(2.0),

  // Redis for Kill Switch check
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Supabase for Multi-Tenant keys
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  CEX_SECRETS_KEY: z.string().optional(),

  // Pool IDs
  CSR_POOL_ID: z.string().default(''),
  CSR25_POOL_ID: z.string().default(''),
  POLL_INTERVAL_MS: z.coerce.number().default(5000),
  LOG_LEVEL: z.string().default('info'),
});

// Parse and Validate
const _config = ConfigSchema.safeParse(process.env);

if (!_config.success) {
  console.error("❌ FATAL: Invalid Configuration");
  console.error(_config.error.format());
  process.exit(1);
}

export const config = _config.data;

// Legacy export for compatibility
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
    REDIS_URL: config.REDIS_URL,
    RPC_URL: config.RPC_URL,
    HTTP_PORT: config.HTTP_PORT,
    CSR_POOL_ID: config.CSR_POOL_ID,
    CSR25_POOL_ID: config.CSR25_POOL_ID,
    POLL_INTERVAL_MS: config.POLL_INTERVAL_MS,
    LOG_LEVEL: config.LOG_LEVEL,
    PRIVATE_KEY: config.PRIVATE_KEY || "",
    SUPABASE_URL: config.SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: config.SUPABASE_SERVICE_ROLE_KEY || "",
    CEX_SECRETS_KEY: config.CEX_SECRETS_KEY || "",
  };
}

// Contract addresses for reference
export const CONTRACTS = {
  UNISWAP_V3_ROUTER: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
  UNISWAP_QUOTER: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
  CSR_TOKEN: '0x6bba316c48b49bd1eac44573c5c871ff02958469',
  CSR25_TOKEN: '0x0f5c78f152152dda52a2ea45b0a8c10733010748',
  WETH_TOKEN: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  USDT_TOKEN: '0xdac17f958d2ee523a2206206994597c13d831ec7',
};

console.log(`[Config] Loaded for environment: ${config.NODE_ENV}`);
if (config.ENABLE_STEALTH_MODE) {
  console.log(`[Config] 🛡️ STEALTH MODE ENABLED (Flashbots Relay: ${config.FLASHBOTS_RELAY_URL})`);
}
