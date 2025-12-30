-- Migration: Add market_snapshots and custodial_wallets tables
-- Run this in Supabase SQL Editor

-- ============================================
-- MARKET SNAPSHOTS (Price Deviation History)
-- ============================================
CREATE TABLE IF NOT EXISTS market_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  market TEXT NOT NULL, -- 'CSR' or 'CSR25'
  cex_bid NUMERIC,
  cex_ask NUMERIC,
  dex_price NUMERIC,
  edge_bps NUMERIC,
  cost_bps NUMERIC,
  edge_after_cost_bps NUMERIC,
  quote_age_ms INTEGER, -- Age of quotes at snapshot time
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_market_snapshots_user_market 
  ON market_snapshots(user_id, market, timestamp DESC);

-- RLS Policy
ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own snapshots" ON market_snapshots
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own snapshots" ON market_snapshots
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ============================================
-- CUSTODIAL WALLETS (Opt-in Full Wallet Control)
-- ============================================
CREATE TABLE IF NOT EXISTS custodial_wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  address TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL, -- Encrypted with libsodium/AES
  encryption_iv TEXT NOT NULL, -- Initialization vector
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ, -- NULL means active
  consent_phrase TEXT, -- The confirmation phrase user typed
  UNIQUE(user_id, address)
);

-- RLS Policy
ALTER TABLE custodial_wallets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own custodial wallets" ON custodial_wallets
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own custodial wallets" ON custodial_wallets
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own custodial wallets" ON custodial_wallets
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- AUDIT LOG (All executions)
-- ============================================
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL, -- 'TRADE_CEX', 'TRADE_DEX', 'CUSTODIAL_ENABLED', 'CUSTODIAL_REVOKED', etc.
  venue TEXT, -- 'LATOKEN', 'LBANK', 'UNISWAP'
  symbol TEXT,
  amount NUMERIC,
  direction TEXT, -- 'BUY', 'SELL'
  success BOOLEAN NOT NULL,
  error_reason TEXT,
  tx_hash TEXT,
  order_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id, created_at DESC);

-- RLS Policy
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own audit logs" ON audit_log
  FOR SELECT USING (auth.uid() = user_id);

-- Service role can insert (backend only)
CREATE POLICY "Service can insert audit logs" ON audit_log
  FOR INSERT WITH CHECK (true);

-- ============================================
-- TRADE HISTORY (if not exists)
-- ============================================
CREATE TABLE IF NOT EXISTS trade_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  price NUMERIC,
  order_id TEXT,
  status TEXT,
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trades" ON trade_history
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Service can insert trades" ON trade_history
  FOR INSERT WITH CHECK (true);
