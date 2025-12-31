import { z } from 'zod';

// ============================================================================
// LATOKEN Gateway Configuration
// ============================================================================

const ConfigSchema = z.object({
  // Latoken WebSocket URL
  LATOKEN_WS_URL: z.string().url().default("wss://api.latoken.com/v2/ws"),

  // Symbols to subscribe (comma-separated, e.g., "CSR/USDT")
  SYMBOLS: z.string().default("CSR/USDT"),

  // Internal WebSocket port (optional legacy support)
  INTERNAL_WS_PORT: z.coerce.number().int().positive().default(8081),

  // HTTP port for health endpoints
  HTTP_PORT: z.coerce.number().int().positive().default(3003),

  // Redis URL for Event Bus
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Poll interval for REST fallback
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),

  // Staleness threshold (seconds)
  MAX_STALENESS_SECONDS: z.coerce.number().positive().default(30),

  // Log level
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Supabase
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  CEX_SECRETS_KEY: z.string().default(""),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const rawConfig = {
    LATOKEN_WS_URL: process.env.LATOKEN_WS_URL,
    SYMBOLS: process.env.SYMBOLS,
    INTERNAL_WS_PORT: process.env.INTERNAL_WS_PORT,
    HTTP_PORT: process.env.HTTP_PORT,
    REDIS_URL: process.env.REDIS_URL,
    POLL_INTERVAL_MS: process.env.POLL_INTERVAL_MS,
    MAX_STALENESS_SECONDS: process.env.MAX_STALENESS_SECONDS,
    LOG_LEVEL: process.env.LOG_LEVEL,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CEX_SECRETS_KEY: process.env.CEX_SECRETS_KEY,
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export function getSymbolsList(config: Config): string[] {
  return config.SYMBOLS.split(',').map(s => s.trim().toUpperCase());
}
