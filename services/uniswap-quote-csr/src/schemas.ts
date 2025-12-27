import { z } from 'zod';

// ============================================================================
// Uniswap Quote Service Schemas
// Per architecture.md: effective_price_usdt, estimated_gas, route
// ============================================================================

export const UniswapQuoteResultSchema = z.object({
  type: z.literal("uniswap.quote"),
  pair: z.string(), // e.g., "CSR/USDT"
  chain_id: z.number(),
  ts: z.string(), // ISO 8601
  amount_in: z.string(),
  amount_in_unit: z.string(),
  amount_out: z.string(),
  amount_out_unit: z.string(),
  effective_price_usdt: z.number(),
  estimated_gas: z.number(),
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

// Quote request schema
export const QuoteRequestSchema = z.object({
  amount_usdt: z.number().positive(),
  direction: z.enum(['buy', 'sell']).default('buy'), // buy = USDT->token, sell = token->USDT
});

export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

// Cached quote entry
export interface CachedQuote {
  quote: UniswapQuoteResult;
  cachedAt: number; // timestamp ms
}
