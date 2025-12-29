# Supabase Multi-User Setup Guide

This guide explains how to set up Supabase for multi-user authentication and per-user settings in CSR Trading Hub.

## Prerequisites

1. Create a Supabase project at https://supabase.com
2. Note your project URL and keys from Settings > API

## Environment Variables

### Frontend (.env)

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Backend (.env)

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_JWT_SECRET=your-jwt-secret

# Encryption key for CEX API secrets (generate with: openssl rand -hex 32)
CEX_SECRETS_KEY=your-32-byte-hex-key
```

## Database Setup

Run the migration in Supabase SQL Editor:

```sql
-- Copy contents from: supabase/migrations/001_create_user_tables.sql
```

This creates:
- `risk_limits` - Per-user trading limits
- `exchange_credentials` - Encrypted CEX API keys
- `wallets` - User wallet addresses
- `audit_log` - Security event logging

All tables have Row Level Security (RLS) enabled so users can only access their own data.

## Authentication Flow

1. User clicks "Sign In" in the navbar
2. Enters email address
3. Receives magic link via email
4. Clicks link to authenticate
5. Frontend receives JWT token
6. All API calls include `Authorization: Bearer <token>`

## API Endpoints

All endpoints require authentication (`Authorization: Bearer <token>`).

### Risk Limits
- `GET /api/me/risk-limits` - Get user's risk limits
- `PUT /api/me/risk-limits` - Update risk limits

### Wallets
- `GET /api/me/wallets` - List user's wallets
- `POST /api/me/wallets` - Add a wallet
- `DELETE /api/me/wallets/:id` - Remove a wallet

### Exchange Credentials
- `GET /api/me/exchanges` - Get connection status (no secrets)
- `POST /api/me/exchanges/lbank` - Save LBank credentials
- `POST /api/me/exchanges/latoken` - Save LATOKEN credentials
- `POST /api/me/exchanges/:venue/test` - Test API keys

## Security Notes

1. **API keys are encrypted** using AES-256-GCM before storage
2. **Encryption key lives only on VPS** - never in Supabase or frontend
3. **RLS ensures isolation** - users can only see their own data
4. **Secrets never reach browser** - only encrypted blobs in DB
5. **Audit logging** tracks all credential changes

## Generating CEX_SECRETS_KEY

```bash
openssl rand -hex 32
```

Store this key securely in your VPS environment. If lost, all encrypted credentials become unrecoverable.

## Testing

1. Sign in with email magic link
2. Go to Settings page
3. Add exchange credentials
4. Click "Test Connection"
5. Check audit log in Supabase dashboard
