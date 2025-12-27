import { z } from 'zod';

// ============================================================================
// Strategy Engine Configuration
// Supports execution modes: off | paper | live
// ============================================================================

const ConfigSchema = z.object({
  // Execution mode: off (monitoring only), paper (simulate), live (execute)
  EXECUTION_MODE: z.enum(["off", "paper", "live"]).default("off"),

  // LBank Gateway WebSocket URL (internal)
  LBANK_GATEWAY_WS_URL: z.string().url().default("ws://localhost:8080"),

  // Uniswap Quote Service URL (internal)
  UNISWAP_QUOTE_URL: z.string().url().default("http://localhost:3002"),

  // Symbols to monitor (comma-separated)
  SYMBOLS: z.string().default("csr_usdt,csr25_usdt"),

  // Uniswap Quote Service URL for CSR
  UNISWAP_QUOTE_CSR_URL: z.string().url().default("http://localhost:3005"),

  // Quote size for Uniswap (in USDT)
  QUOTE_SIZE_USDT: z.coerce.number().positive().default(1000),

  // Minimum edge threshold in basis points to consider trading
  MIN_EDGE_BPS: z.coerce.number().min(0).default(50), // 0.5%

  // Estimated trading costs in basis points
  // Includes: LP fees, gas, slippage buffer
  ESTIMATED_COST_BPS: z.coerce.number().min(0).default(30), // 0.3%

  // Maximum trade size in USDT
  MAX_TRADE_SIZE_USDT: z.coerce.number().positive().default(5000),

  // Polling interval for Uniswap quotes (ms)
  UNISWAP_POLL_INTERVAL_MS: z.coerce.number().positive().default(10000), // 10s

  // Staleness threshold (seconds)
  MAX_STALENESS_SECONDS: z.coerce.number().positive().default(30),

  // HTTP port for health endpoints
  HTTP_PORT: z.coerce.number().int().positive().default(3003),

  // Log level
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const rawConfig = {
    EXECUTION_MODE: process.env.EXECUTION_MODE,
    LBANK_GATEWAY_WS_URL: process.env.LBANK_GATEWAY_WS_URL,
    UNISWAP_QUOTE_URL: process.env.UNISWAP_QUOTE_URL,
    SYMBOLS: process.env.SYMBOLS,
    UNISWAP_QUOTE_CSR_URL: process.env.UNISWAP_QUOTE_CSR_URL,
    QUOTE_SIZE_USDT: process.env.QUOTE_SIZE_USDT,
    MIN_EDGE_BPS: process.env.MIN_EDGE_BPS,
    ESTIMATED_COST_BPS: process.env.ESTIMATED_COST_BPS,
    MAX_TRADE_SIZE_USDT: process.env.MAX_TRADE_SIZE_USDT,
    UNISWAP_POLL_INTERVAL_MS: process.env.UNISWAP_POLL_INTERVAL_MS,
    MAX_STALENESS_SECONDS: process.env.MAX_STALENESS_SECONDS,
    HTTP_PORT: process.env.HTTP_PORT,
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
