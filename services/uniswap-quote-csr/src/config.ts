import { z } from 'zod';

// ============================================================================
// Uniswap Quote Service Configuration
// Per docs.md: token addresses and chain IDs must be configurable
// ============================================================================

const TokenConfigSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address'),
  decimals: z.coerce.number().int().min(0).max(18),
  symbol: z.string(),
});

const ConfigSchema = z.object({
  // Chain configuration
  CHAIN_ID: z.coerce.number().int().positive().default(1), // Mainnet default

  // RPC URL (required - no default to prevent accidental misconfiguration)
  RPC_URL: z.string().url(),

  // Token configurations as JSON strings
  TOKEN_IN_CONFIG: z
    .string()
    .transform((str) => JSON.parse(str))
    .pipe(TokenConfigSchema),
  TOKEN_OUT_CONFIG: z
    .string()
    .transform((str) => JSON.parse(str))
    .pipe(TokenConfigSchema),

  // Quote sizes in USDT (comma-separated)
  QUOTE_SIZES_USDT: z.string().default("100,500,1000"),

  // Cache TTL in seconds
  QUOTE_CACHE_TTL_SECONDS: z.coerce.number().positive().default(30),

  // HTTP port for API
  HTTP_PORT: z.coerce.number().int().positive().default(3002),

  // Max staleness threshold in seconds
  MAX_STALENESS_SECONDS: z.coerce.number().positive().default(120),

  // Slippage tolerance (as percentage, e.g., 0.5 = 0.5%)
  SLIPPAGE_TOLERANCE_PERCENT: z.coerce.number().min(0).max(50).default(0.5),

  // Uniswap v4 pool IDs (64 characters)
  CSR_POOL_ID: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid pool ID"),
  CSR25_POOL_ID: z.string().regex(/^0x[a-fA-F0-9]{64}$/, "Invalid pool ID"),

  // Uniswap v4 Manager contract
  UNISWAP_V4_MANAGER_ADDRESS: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid contract address"),

  // Log level
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type TokenConfig = z.infer<typeof TokenConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const rawConfig = {
    CHAIN_ID: process.env.CHAIN_ID,
    RPC_URL: process.env.RPC_URL,
    TOKEN_IN_CONFIG: process.env.TOKEN_IN_CONFIG,
    TOKEN_OUT_CONFIG: process.env.TOKEN_OUT_CONFIG,
    QUOTE_SIZES_USDT: process.env.QUOTE_SIZES_USDT,
    QUOTE_CACHE_TTL_SECONDS: process.env.QUOTE_CACHE_TTL_SECONDS,
    HTTP_PORT: process.env.HTTP_PORT,
    MAX_STALENESS_SECONDS: process.env.MAX_STALENESS_SECONDS,
    SLIPPAGE_TOLERANCE_PERCENT: process.env.SLIPPAGE_TOLERANCE_PERCENT,
    CSR_POOL_ID: process.env.CSR_POOL_ID,
    CSR25_POOL_ID: process.env.CSR25_POOL_ID,
    UNISWAP_V4_MANAGER_ADDRESS: process.env.UNISWAP_V4_MANAGER_ADDRESS,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error("Configuration validation failed:");
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export function getQuoteSizes(config: Config): number[] {
  return config.QUOTE_SIZES_USDT.split(',').map((s: string) => parseFloat(s.trim()));
}
