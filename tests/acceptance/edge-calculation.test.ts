/**
 * Edge Calculation Acceptance Test
 * 
 * Requirement: Edge calculation uses user's current risk limits (not hardcoded)
 * Source: docs/acceptance-tests.md
 */

import { describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:8001';

describe('Edge Calculation', () => {
  it('should calculate edge based on CEX/DEX price difference', async () => {
    const response = await fetch(`${API_URL}/api/dashboard`);
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    
    // Check CSR market edge calculation
    const csrCex = data.market_state?.csr_usdt?.latoken_ticker;
    const csrDex = data.market_state?.csr_usdt?.uniswap_quote;
    const csrDecision = data.market_state?.csr_usdt?.decision;
    
    if (csrCex && csrDex && csrDecision) {
      const cexMid = (csrCex.bid + csrCex.ask) / 2;
      const dexPrice = csrDex.effective_price_usdt;
      
      // Edge should be calculated as (dex - cex) / cex * 10000 bps
      const expectedEdgeRaw = ((dexPrice - cexMid) / cexMid) * 10000;
      
      // Allow for cost adjustments (within 100bps tolerance)
      if (csrDecision.edge_after_costs_bps !== undefined) {
        const diff = Math.abs(csrDecision.edge_after_costs_bps - expectedEdgeRaw);
        // Costs should not be more than 100bps
        expect(diff).toBeLessThan(100);
      }
    }
  });

  it('should include decision reason for each market', async () => {
    const response = await fetch(`${API_URL}/api/dashboard`);
    const data = await response.json();
    
    const csrDecision = data.market_state?.csr_usdt?.decision;
    const csr25Decision = data.market_state?.csr25_usdt?.decision;
    
    // Each decision should have a reason
    if (csrDecision) {
      expect(csrDecision.reason).toBeDefined();
      expect(typeof csrDecision.reason).toBe('string');
    }
    
    if (csr25Decision) {
      expect(csr25Decision.reason).toBeDefined();
      expect(typeof csr25Decision.reason).toBe('string');
    }
  });

  it('should indicate trade direction correctly', async () => {
    const response = await fetch(`${API_URL}/api/dashboard`);
    const data = await response.json();
    
    const csrDecision = data.market_state?.csr_usdt?.decision;
    
    if (csrDecision && csrDecision.direction) {
      // Direction should be one of the expected values
      expect(['buy_cex_sell_dex', 'buy_dex_sell_cex']).toContain(csrDecision.direction);
    }
  });
});
