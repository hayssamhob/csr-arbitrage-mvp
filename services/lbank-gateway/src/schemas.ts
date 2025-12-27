import { z } from 'zod';

// ============================================================================
// Internal normalized schemas (matches shared/schemas.ts)
// ============================================================================
export const LBankTickerEventSchema = z.object({
  type: z.literal('lbank.ticker'),
  symbol: z.string(),
  ts: z.string(),
  bid: z.number(),
  ask: z.number(),
  last: z.number(),
  volume_24h: z.number().optional(),
  source_ts: z.string().optional(),
});

export type LBankTickerEvent = z.infer<typeof LBankTickerEventSchema>;

export const LBankDepthEventSchema = z.object({
  type: z.literal('lbank.depth'),
  symbol: z.string(),
  ts: z.string(),
  bids: z.array(z.tuple([z.number(), z.number()])),
  asks: z.array(z.tuple([z.number(), z.number()])),
  source_ts: z.string().optional(),
});

export type LBankDepthEvent = z.infer<typeof LBankDepthEventSchema>;

// ============================================================================
// Raw LBank WebSocket message schemas
// EXPERIMENTAL: Based on LBank docs - must validate against live messages
// Reference: https://www.lbank.com/en-US/docs/
// ============================================================================

// Ping/Pong for heartbeat
export const LBankPingSchema = z.object({
  ping: z.string(),
});

export const LBankPongSchema = z.object({
  pong: z.string(),
});

// Error messages returned by LBank V2 WS (e.g. invalid pairs)
export const LBankErrorMessageSchema = z.object({
  SERVER: z.string().optional(),
  status: z.literal('error'),
  message: z.string(),
  TS: z.string().optional(),
});

// Subscribe response
export const LBankSubscribeResponseSchema = z.object({
  action: z.literal('subscribe'),
  subscribe: z.string(),
  pair: z.string(),
  status: z.string().optional(),
});

// Ticker data from LBank
// Format validated against live LBank V2 WebSocket messages
// Note: LBank returns numeric values, not strings
export const RawLBankTickerSchema = z.object({
  tick: z.object({
    latest: z.union([z.string(), z.number()]).transform((v) => String(v)),
    change: z.union([z.string(), z.number()]).transform((v) => String(v)),
    high: z.union([z.string(), z.number()]).transform((v) => String(v)),
    low: z.union([z.string(), z.number()]).transform((v) => String(v)),
    vol: z.union([z.string(), z.number()]).transform((v) => String(v)),
    turnover: z
      .union([z.string(), z.number()])
      .transform((v) => String(v))
      .optional(),
    to_cny: z.union([z.string(), z.number()]).optional(),
    to_usd: z.union([z.string(), z.number()]).optional(),
    usd: z.union([z.string(), z.number()]).optional(),
    cny: z.union([z.string(), z.number()]).optional(),
    dir: z.string().optional(),
  }),
  pair: z.string(),
  type: z.string(),
  SERVER: z.string().optional(),
  TS: z.string().optional(),
});

// Depth data from LBank
export const RawLBankDepthSchema = z.object({
  depth: z.object({
    bids: z.array(z.tuple([z.string(), z.string()])),
    asks: z.array(z.tuple([z.string(), z.string()])),
  }),
  pair: z.string(),
  type: z.string(),
  SERVER: z.string().optional(),
  TS: z.string().optional(),
});

// Union type for incoming messages
export type RawLBankMessage =
  | z.infer<typeof LBankPingSchema>
  | z.infer<typeof LBankSubscribeResponseSchema>
  | z.infer<typeof LBankErrorMessageSchema>
  | z.infer<typeof RawLBankTickerSchema>
  | z.infer<typeof RawLBankDepthSchema>;
