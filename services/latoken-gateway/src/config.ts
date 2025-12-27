import { z } from 'zod';

// ============================================================================
// Configuration validation with Zod
// ============================================================================
const ConfigSchema = z.object({
  // Latoken API
  LATOKEN_API_KEY: z.string().min(1, 'LATOKEN_API_KEY is required'),
  LATOKEN_API_SECRET: z.string().min(1, 'LATOKEN_API_SECRET is required'),
  LATOKEN_API_URL: z.string().url().default('https://api.latoken.com'),
  
  // Service ports
  INTERNAL_WS_PORT: z.coerce.number().int().positive().default(8081),
  HTTP_PORT: z.coerce.number().int().positive().default(3006),
  
  // Polling settings
  POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  MAX_STALENESS_SECONDS: z.coerce.number().int().positive().default(15),
  
  // Symbols
  SYMBOLS: z.string().transform((val) => val.split(',').map(s => s.trim()).filter(Boolean)),
  
  // Logging
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const rawConfig = {
    LATOKEN_API_KEY: process.env.LATOKEN_API_KEY,
    LATOKEN_API_SECRET: process.env.LATOKEN_API_SECRET,
    LATOKEN_API_URL: process.env.LATOKEN_API_URL,
    INTERNAL_WS_PORT: process.env.INTERNAL_WS_PORT,
    HTTP_PORT: process.env.HTTP_PORT,
    POLL_INTERVAL_MS: process.env.POLL_INTERVAL_MS,
    MAX_STALENESS_SECONDS: process.env.MAX_STALENESS_SECONDS,
    SYMBOLS: process.env.SYMBOLS || 'CSR_USDT',
    LOG_LEVEL: process.env.LOG_LEVEL,
  };

  const config = ConfigSchema.parse(rawConfig);
  return config;
}

export function getSymbolsList(config: Config): string[] {
  return config.SYMBOLS;
}
