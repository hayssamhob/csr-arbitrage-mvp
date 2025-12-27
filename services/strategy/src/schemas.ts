import { z } from 'zod';

// ============================================================================
// Strategy Engine Schemas
// DRY-RUN ONLY - No execution
// ============================================================================

// LBank ticker event (from gateway)
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

// Latoken ticker event (from gateway)
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

// Generic CEX ticker (either LBank or Latoken)
export type CexTickerEvent = LBankTickerEvent | LatokenTickerEvent;

// Uniswap quote result (from quote service)
export const UniswapQuoteResultSchema = z.object({
  type: z.literal("uniswap.quote"),
  pair: z.string(),
  chain_id: z.number(),
  ts: z.string(),
  amount_in: z.string(),
  amount_in_unit: z.string(),
  amount_out: z.string(),
  amount_out_unit: z.string(),
  effective_price_usdt: z.number(),
  estimated_gas: z.number(),
  gas_price_gwei: z.number().optional(),
  gas_cost_usdt: z.number().optional(),
  route: z
    .object({
      summary: z.string(),
      pools: z.array(z.string()).optional(),
    })
    .optional(),
  is_stale: z.boolean().optional(),
  validated: z.boolean().optional(),
  source: z.string().optional(),
  error: z.string().optional(),
});

export type UniswapQuoteResult = z.infer<typeof UniswapQuoteResultSchema>;

// Strategy decision (dry-run output)
export const StrategyDecisionSchema = z.object({
  type: z.literal("strategy.decision"),
  ts: z.string(),
  symbol: z.string(),
  lbank_bid: z.number(),
  lbank_ask: z.number(),
  uniswap_price: z.number(),
  raw_spread_bps: z.number(),
  estimated_cost_bps: z.number(),
  cost_breakdown: z
    .object({
      cex_fee_bps: z.number(),
      dex_lp_fee_bps: z.number(),
      gas_cost_bps: z.number(),
      network_fee_bps: z.number(),
      slippage_bps: z.number(),
    })
    .optional(),
  edge_after_costs_bps: z.number(),
  would_trade: z.boolean(),
  direction: z.enum(["buy_cex_sell_dex", "buy_dex_sell_cex", "none"]),
  suggested_size_usdt: z.number(),
  reason: z.string(),
});

export type StrategyDecision = z.infer<typeof StrategyDecisionSchema>;
