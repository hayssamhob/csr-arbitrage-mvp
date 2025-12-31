import { z } from 'zod';

// Configuration schema with validation
const ConfigSchema = z.object({
  // LBank WebSocket URL
  // Try public market data endpoint first, fallback to authenticated
  LBANK_WS_URL: z.string().url().default("wss://www.lbkex.net/ws/V2/"),

  // Symbols to subscribe (comma-separated)
  // NOTE: csr_usdt doesn't exist on LBank, only csr25_usdt
  SYMBOLS: z.string().default("csr25_usdt"),

  // Internal WebSocket port for broadcasting
  INTERNAL_WS_PORT: z.coerce.number().int().positive().default(8080),

  // HTTP port for health endpoints
  HTTP_PORT: z.coerce.number().int().positive().default(3001),

  // Staleness threshold in seconds
  MAX_STALENESS_SECONDS: z.coerce.number().positive().default(10),

  // Redis URL for Event Bus
  REDIS_URL: z.string().default("redis://localhost:6379"),

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
    LBANK_WS_URL: process.env.LBANK_WS_URL,
    SYMBOLS: process.env.SYMBOLS,
    INTERNAL_WS_PORT: process.env.INTERNAL_WS_PORT,
    HTTP_PORT: process.env.HTTP_PORT,
    MAX_STALENESS_SECONDS: process.env.MAX_STALENESS_SECONDS,
    REDIS_URL: process.env.REDIS_URL,
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
  return config.SYMBOLS.split(',').map(s => s.trim().toLowerCase());
}
