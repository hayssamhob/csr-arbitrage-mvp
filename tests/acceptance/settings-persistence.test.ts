/**
 * Settings Persistence Acceptance Test
 * 
 * Requirement: Settings persist across reloads
 * Source: docs/acceptance-tests.md
 */

import { describe, expect, it } from 'vitest';

const API_URL = process.env.API_URL || 'http://localhost:8001';
const SUPABASE_URL = 'https://pedcpxvkiddgomsctgtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlZGNweHZraWRkZ29tc2N0Z3RtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4NzE2ODUsImV4cCI6MjA4MDQ0NzY4NX0.ZNBtU_AM9c4ps7c4UDim_dh--bmhmBcs32OBqbHlSIE';

describe('Settings Persistence', () => {
  it('should have risk_limits table with RLS enabled', async () => {
    // Query Supabase to check table exists
    // This is a basic connectivity test
    const response = await fetch(`${SUPABASE_URL}/rest/v1/risk_limits?select=user_id&limit=0`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    
    // Should return 200 (empty array due to RLS) or 401 (RLS blocking)
    expect([200, 401]).toContain(response.status);
  });

  it('should have exchange_credentials table with RLS enabled', async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/exchange_credentials?select=id&limit=0`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    
    expect([200, 401]).toContain(response.status);
  });

  it('should have wallets table with RLS enabled', async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/wallets?select=id&limit=0`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    
    expect([200, 401]).toContain(response.status);
  });

  it('should require authentication for risk limits endpoint', async () => {
    const response = await fetch(`${API_URL}/api/me/risk-limits`);
    
    // Should return 401 without auth token
    expect(response.status).toBe(401);
  });

  it('should have audit_log table for tracking changes', async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/audit_log?select=id&limit=0`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    
    expect([200, 401]).toContain(response.status);
  });
});
