import { z } from 'zod';

// ============================================================================
// LATOKEN Gateway Configuration
// API keys optional for public market data
// ============================================================================

const ConfigSchema = z.object({
  // LATOKEN API (optional for public endpoints)
  LATOKEN_API_KEY: z.string().optional().default(""),
  LATOKEN_API_SECRET: z.string().optional().default(""),

  // Service ports
  INTERNAL_WS_PORT: z.coerce.number().int().positive().default(8081),
  HTTP_PORT: z.coerce.number().int().positive().default(3006),

  // Polling settings
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  MAX_STALENESS_SECONDS: z.coerce.number().int().positive().default(15),

  // Symbols (internal format: csr_usdt)
  SYMBOLS: z.string().transform((val) =>
    val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  ),

  // Mock mode for testing when API is blocked
  MOCK_MODE: z.coerce.boolean().default(false),
  MOCK_BID: z.coerce.number().default(0.85),
  MOCK_ASK: z.coerce.number().default(0.86),
  MOCK_LAST: z.coerce.number().default(0.855),

  // Logging
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const rawConfig = {
    LATOKEN_API_KEY: process.env.LATOKEN_API_KEY,
    LATOKEN_API_SECRET: process.env.LATOKEN_API_SECRET,
    INTERNAL_WS_PORT: process.env.INTERNAL_WS_PORT,
    HTTP_PORT: process.env.HTTP_PORT,
    POLL_INTERVAL_MS: process.env.POLL_INTERVAL_MS,
    MAX_STALENESS_SECONDS: process.env.MAX_STALENESS_SECONDS,
    SYMBOLS: process.env.SYMBOLS || "csr_usdt",
    MOCK_MODE: process.env.MOCK_MODE,
    MOCK_BID: process.env.MOCK_BID,
    MOCK_ASK: process.env.MOCK_ASK,
    MOCK_LAST: process.env.MOCK_LAST,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };

  return ConfigSchema.parse(rawConfig);
}

export function getSymbolsList(config: Config): string[] {
  return config.SYMBOLS;
}
