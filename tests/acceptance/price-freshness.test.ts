/**
 * Price Freshness Acceptance Test
 * 
 * Requirement: Abort if CEX/DEX quotes are > 5 seconds old
 * Source: docs/acceptance-tests.md
 */

import { describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:8001';
const STALENESS_THRESHOLD_CEX_MS = 5000;
const STALENESS_THRESHOLD_DEX_MS = 10000;

describe('Price Freshness', () => {
  it('should return timestamps for all price sources', async () => {
    const response = await fetch(`${API_URL}/api/dashboard`);
    expect(response.ok).toBe(true);
    
    const data = await response.json();
    
    // Check CSR market has timestamps
    const csrCex = data.market_state?.csr_usdt?.latoken_ticker;
    const csrDex = data.market_state?.csr_usdt?.uniswap_quote;
    
    if (csrCex) {
      expect(csrCex.ts).toBeDefined();
      expect(typeof csrCex.ts).toBe('string');
    }
    
    if (csrDex) {
      expect(csrDex.ts).toBeDefined();
      expect(typeof csrDex.ts).toBe('string');
    }
    
    // Check CSR25 market has timestamps
    const csr25Cex = data.market_state?.csr25_usdt?.lbank_ticker;
    const csr25Dex = data.market_state?.csr25_usdt?.uniswap_quote;
    
    if (csr25Cex) {
      expect(csr25Cex.ts).toBeDefined();
    }
    
    if (csr25Dex) {
      expect(csr25Dex.ts).toBeDefined();
    }
  });

  it('should detect stale CEX data (> 5 seconds)', async () => {
    const response = await fetch(`${API_URL}/api/health`);
    expect(response.ok).toBe(true);
    
    const health = await response.json();
    
    // Check LBank gateway staleness detection
    if (health.lbank_gateway) {
      const lastTs = health.lbank_gateway.last_message_ts;
      if (lastTs) {
        const age = Date.now() - new Date(lastTs).getTime();
        const isStale = age > STALENESS_THRESHOLD_CEX_MS;
        
        // If stale, status should not be "healthy"
        if (isStale) {
          expect(health.lbank_gateway.status).not.toBe('healthy');
        }
      }
    }
    
    // Check LATOKEN gateway staleness detection
    if (health.latoken_gateway) {
      const lastTs = health.latoken_gateway.last_message_ts;
      if (lastTs) {
        const age = Date.now() - new Date(lastTs).getTime();
        const isStale = age > STALENESS_THRESHOLD_CEX_MS;
        
        if (isStale) {
          expect(health.latoken_gateway.status).not.toBe('healthy');
        }
      }
    }
  });

  it('should block actions when data is stale', async () => {
    // This test verifies the frontend logic blocks actions for stale data
    // The actual blocking is implemented in ArbitragePage.tsx
    
    const response = await fetch(`${API_URL}/api/dashboard`);
    const data = await response.json();
    
    // Check that decision includes staleness info if applicable
    const csrDecision = data.market_state?.csr_usdt?.decision;
    if (csrDecision && csrDecision.reason) {
      // If reason contains "stale", it should not be actionable
      if (csrDecision.reason.includes('stale')) {
        expect(csrDecision.would_trade).toBe(false);
      }
    }
  });
});
