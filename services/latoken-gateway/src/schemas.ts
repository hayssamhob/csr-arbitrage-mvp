import { z } from 'zod';

// ============================================================================
// Internal normalized schemas (matches LBank gateway for compatibility)
// ============================================================================
export const LatokenTickerEventSchema = z.object({
  type: z.literal('latoken.ticker'),
  symbol: z.string(),
  ts: z.string(),
  bid: z.number(),
  ask: z.number(),
  last: z.number(),
  volume_24h: z.number().optional(),
  source_ts: z.string().optional(),
});

export type LatokenTickerEvent = z.infer<typeof LatokenTickerEventSchema>;

// ============================================================================
// Raw Latoken API response schemas
// EXPERIMENTAL: Based on common exchange API patterns
// ============================================================================
export const RawLatokenTickerSchema = z.object({
  symbol: z.string(),
  price: z.string(),
  bid: z.string().optional(),
  ask: z.string().optional(),
  volume: z.string().optional(),
  timestamp: z.number().optional(),
});

export type RawLatokenTicker = z.infer<typeof RawLatokenTickerSchema>;
