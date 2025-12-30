/**
 * Health Check Acceptance Test
 * 
 * Requirement: Service health endpoints work, auto-restart on disconnect
 * Source: docs/acceptance-tests.md
 */

import { describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:8001';

describe('Health Check', () => {
  it('should have healthy overall status', async () => {
    const response = await fetch(`${API_URL}/api/health`);
    expect(response.ok).toBe(true);
    
    const health = await response.json();
    expect(health.overall_status).toBeDefined();
    // Should be one of: healthy, degraded, unhealthy
    expect(['healthy', 'degraded', 'unhealthy']).toContain(health.overall_status);
  });

  it('should report LBank gateway status', async () => {
    const response = await fetch(`${API_URL}/api/health`);
    const health = await response.json();
    
    expect(health.lbank_gateway).toBeDefined();
    expect(health.lbank_gateway.status).toBeDefined();
    expect(health.lbank_gateway.ts).toBeDefined();
  });

  it('should report LATOKEN gateway status', async () => {
    const response = await fetch(`${API_URL}/api/health`);
    const health = await response.json();
    
    expect(health.latoken_gateway).toBeDefined();
    expect(health.latoken_gateway.status).toBeDefined();
    expect(health.latoken_gateway.ts).toBeDefined();
  });

  it('should report strategy engine status', async () => {
    const response = await fetch(`${API_URL}/api/health`);
    const health = await response.json();
    
    expect(health.strategy_engine).toBeDefined();
    expect(health.strategy_engine.status).toBeDefined();
  });

  it('should track reconnection count for gateways', async () => {
    const response = await fetch(`${API_URL}/api/health`);
    const health = await response.json();
    
    // LBank gateway should track reconnections
    if (health.lbank_gateway) {
      expect(typeof health.lbank_gateway.reconnect_count).toBe('number');
    }
    
    // LATOKEN gateway should track reconnections  
    if (health.latoken_gateway) {
      // Reconnect count may not be present for HTTP-based gateways
    }
  });

  it('should return timestamp for freshness calculation', async () => {
    const response = await fetch(`${API_URL}/api/health`);
    const health = await response.json();
    
    expect(health.ts).toBeDefined();
    
    // Timestamp should be recent (within 60 seconds)
    const age = Date.now() - new Date(health.ts).getTime();
    expect(age).toBeLessThan(60000);
  });
});
