-- Add custodial fields to wallets table
ALTER TABLE wallets 
ADD COLUMN IF NOT EXISTS private_key_enc TEXT,
ADD COLUMN IF NOT EXISTS is_custodial BOOLEAN DEFAULT false;

-- Add index for finding custodial wallets
CREATE INDEX IF NOT EXISTS idx_wallets_custodial ON wallets(user_id) WHERE is_custodial = true;

-- Update RLS policies if needed (existing policies cover update/insert/select for owner, which is fine)
-- We might want to ensure private_key_enc is NOT returned in standard SELECTs if we were strict,
-- but for MVP the backend (user routes) filters this.
