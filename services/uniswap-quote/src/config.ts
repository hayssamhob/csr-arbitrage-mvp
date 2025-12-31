import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

/**
 * Configuration Schema using Zod for strict validation
 * Fails fast if critical production keys are missing.
 */
const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  HTTP_PORT: z.coerce.number().default(3002),

  // Blockchain Access
  RPC_URL: z
    .string()
    .url()
    .default("https://mainnet.infura.io/v3/4030c256a99c4a3d91b7c1075e5bffcb"),
  CHAIN_ID: z.coerce.number().default(1),

  // Execution Wallet (Multi-tenant: fetched per-user, but this is fallback)
  PRIVATE_KEY: z.string().optional(),

  // Flashbots & Privacy
  FLASHBOTS_RELAY_URL: z.string().url().default("https://relay.flashbots.net"),
  ENABLE_STEALTH_MODE: z.coerce.boolean().default(true),

  // Safety Limits
  MAX_GAS_PRICE_GWEI: z.coerce.number().default(100), // Abort if gas > 100 gwei
  MAX_SLIPPAGE_PERCENT: z.coerce.number().default(2.0),

  // Redis for Kill Switch check
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Supabase for Multi-Tenant keys
  SUPABASE_URL: z.string().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  CEX_SECRETS_KEY: z.string().optional(),

  // Pool IDs (verified live on mainnet)
  CSR_POOL_ID: z
    .string()
    .default(
      "0x6c76bb9f364e72fcb57819d2920550768cf43e09e819daa40fabe9c7ab057f9e"
    ),
  CSR25_POOL_ID: z
    .string()
    .default(
      "0x46afcc847653fa391320b2bde548c59cf384b029933667c541fb730c5641778e"
    ),
  CSR_POOL_FEE_BPS: z.coerce.number().optional(),
  CSR25_POOL_FEE_BPS: z.coerce.number().optional(),
  CSR_POOL_TICK_SPACING: z.coerce.number().optional(),
  CSR25_POOL_TICK_SPACING: z.coerce.number().optional(),
  CSR_POOL_HOOK: z.string().optional(),
  CSR25_POOL_HOOK: z.string().optional(),
  POLL_INTERVAL_MS: z.coerce.number().default(5000),
  LOG_LEVEL: z.string().default("info"),
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
  CSR_POOL_FEE_BPS?: number;
  CSR25_POOL_FEE_BPS?: number;
  CSR_POOL_TICK_SPACING?: number;
  CSR25_POOL_TICK_SPACING?: number;
  CSR_POOL_HOOK?: string;
  CSR25_POOL_HOOK?: string;
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
    // Optional V4 parameters (fall back to undefined)
    CSR_POOL_FEE_BPS: config.CSR_POOL_FEE_BPS,
    CSR25_POOL_FEE_BPS: config.CSR25_POOL_FEE_BPS,
    CSR_POOL_TICK_SPACING: config.CSR_POOL_TICK_SPACING,
    CSR25_POOL_TICK_SPACING: config.CSR25_POOL_TICK_SPACING,
    CSR_POOL_HOOK: config.CSR_POOL_HOOK,
    CSR25_POOL_HOOK: config.CSR25_POOL_HOOK,
    POLL_INTERVAL_MS: config.POLL_INTERVAL_MS,
    LOG_LEVEL: config.LOG_LEVEL,
    PRIVATE_KEY: config.PRIVATE_KEY || "",
    SUPABASE_URL: config.SUPABASE_URL || "",
    SUPABASE_SERVICE_ROLE_KEY: config.SUPABASE_SERVICE_ROLE_KEY || "",
    CEX_SECRETS_KEY: config.CEX_SECRETS_KEY || "",
  };
}

// ============================================================================
// Verified Uniswap V4 Contract Addresses (Ethereum Mainnet)
// Source: docs.uniswap.org/contracts/v4/deployments
// ============================================================================
export const UNISWAP_V4 = {
  // Core singleton contracts
  POOL_MANAGER: "0x000000000004444c5dc75cB358380D2e3dE08A90",
  STATE_VIEW: "0x7ffe42c4a5deea5b0fec41c94c136cf115597227",
  QUOTER: "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203",
  UNIVERSAL_ROUTER: "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af",
};

// Token addresses (checksummed)
export const TOKENS = {
  CSR: "0x75Ecb52e403C617679FBd3e77A50f9d10A842387",
  CSR25: "0x502E7230E142A332DFEd1095F7174834b2548982",
  WETH: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
};

// V4 Pool Parameters with verified Pool IDs
export const POOL_PARAMS = {
  CSR_USDT: {
    currency0: TOKENS.CSR,
    currency1: TOKENS.USDT,
    fee: 3000, // 0.3%
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000",
    poolId:
      "0x6c76bb9f364e72fcb57819d2920550768cf43e09e819daa40fabe9c7ab057f9e",
  },
  CSR25_USDT: {
    currency0: TOKENS.CSR25,
    currency1: TOKENS.USDT,
    fee: 3000, // 0.3%
    tickSpacing: 60,
    hooks: "0x0000000000000000000000000000000000000000",
    poolId:
      "0x46afcc847653fa391320b2bde548c59cf384b029933667c541fb730c5641778e",
  },
};

// Fee constants for edge calculation
export const FEE_CONSTANTS = {
  V4_LP_FEE_BPS: 30, // 0.3% = 30 basis points
  ESTIMATED_GAS_USD: 0.15, // $0.15 gas buffer
  MIN_NET_EDGE_BPS: 50, // 0.5% minimum net edge to trade
};

// Legacy export for compatibility
export const CONTRACTS = {
  UNISWAP_V4_MANAGER: UNISWAP_V4.POOL_MANAGER,
  UNISWAP_V4_STATE_VIEW: UNISWAP_V4.STATE_VIEW,
  UNISWAP_V4_QUOTER: UNISWAP_V4.QUOTER,
  CSR_TOKEN: TOKENS.CSR,
  CSR25_TOKEN: TOKENS.CSR25,
  WETH_TOKEN: TOKENS.WETH,
  USDT_TOKEN: TOKENS.USDT,
};

console.log(`[Config] Loaded for environment: ${config.NODE_ENV}`);
if (config.ENABLE_STEALTH_MODE) {
  console.log(`[Config] 🛡️ STEALTH MODE ENABLED (Flashbots Relay: ${config.FLASHBOTS_RELAY_URL})`);
}
