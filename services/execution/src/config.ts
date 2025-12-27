import { z } from 'zod';

// ============================================================================
// Execution Service Configuration
// Supports OFF/PAPER/LIVE modes with strict safety controls
// ============================================================================

const ConfigSchema = z.object({
  // Execution mode: off (monitoring), paper (simulate), live (real orders)
  EXECUTION_MODE: z.enum(['off', 'paper', 'live']).default('off'),

  // Kill switch - disables ALL execution when true
  KILL_SWITCH: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().default(true)
  ),

  // Risk Controls (mandatory)
  MAX_ORDER_USDT: z.coerce.number().positive().default(1000),
  MAX_DAILY_VOLUME_USDT: z.coerce.number().positive().default(10000),
  MIN_EDGE_BPS: z.coerce.number().min(0).default(50),
  MAX_SLIPPAGE_BPS: z.coerce.number().min(0).default(100),
  MAX_STALENESS_SECONDS: z.coerce.number().positive().default(30),
  MAX_CONCURRENT_ORDERS: z.coerce.number().int().positive().default(1),

  // Strategy Engine URL
  STRATEGY_ENGINE_URL: z.string().url().default('http://localhost:3003'),

  // LBank API credentials (required for live mode)
  LBANK_API_KEY: z.string().optional(),
  LBANK_API_SECRET: z.string().optional(),

  // HTTP port
  HTTP_PORT: z.coerce.number().int().positive().default(3004),

  // Database path
  DB_PATH: z.string().default('./data/execution.db'),

  // Log level
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const rawConfig = {
    EXECUTION_MODE: process.env.EXECUTION_MODE,
    KILL_SWITCH: process.env.KILL_SWITCH,
    MAX_ORDER_USDT: process.env.MAX_ORDER_USDT,
    MAX_DAILY_VOLUME_USDT: process.env.MAX_DAILY_VOLUME_USDT,
    MIN_EDGE_BPS: process.env.MIN_EDGE_BPS,
    MAX_SLIPPAGE_BPS: process.env.MAX_SLIPPAGE_BPS,
    MAX_STALENESS_SECONDS: process.env.MAX_STALENESS_SECONDS,
    MAX_CONCURRENT_ORDERS: process.env.MAX_CONCURRENT_ORDERS,
    STRATEGY_ENGINE_URL: process.env.STRATEGY_ENGINE_URL,
    LBANK_API_KEY: process.env.LBANK_API_KEY,
    LBANK_API_SECRET: process.env.LBANK_API_SECRET,
    HTTP_PORT: process.env.HTTP_PORT,
    DB_PATH: process.env.DB_PATH,
    LOG_LEVEL: process.env.LOG_LEVEL,
  };

  const result = ConfigSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export function validateLiveMode(config: Config): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.EXECUTION_MODE !== 'live') {
    return { valid: true, errors: [] };
  }

  // Live mode requires additional validation
  if (config.KILL_SWITCH) {
    errors.push('KILL_SWITCH must be false for live mode');
  }

  if (!config.LBANK_API_KEY) {
    errors.push('LBANK_API_KEY is required for live mode');
  }

  if (!config.LBANK_API_SECRET) {
    errors.push('LBANK_API_SECRET is required for live mode');
  }

  return { valid: errors.length === 0, errors };
}
