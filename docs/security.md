# Security Documentation

## Overview

CSRHub Live Arbitrage handles sensitive financial data and optional custodial wallet control. This document describes the security measures in place.

---

## 1. Authentication & Authorization

### Supabase Auth
- Email magic link authentication (no passwords stored)
- JWT tokens with short expiration
- All API endpoints require valid JWT verification
- Row Level Security (RLS) enforced on all user tables

### Backend Verification
- Every request is scoped to `user_id` extracted from JWT
- Service role key used only server-side, never exposed to frontend

---

## 2. Exchange Credentials (CEX API Keys)

### Storage
- API secrets stored in `exchange_credentials` table
- Encrypted at rest using AES-256-CBC encryption
- Encryption key stored in server environment (`CEX_SECRETS_KEY`)
- Initialization vector (IV) stored alongside encrypted data

### Decryption
- Decryption happens **only** server-side at execution time
- Decrypted secrets are never logged or cached
- Used immediately for API calls, then discarded from memory

### Revocation
- Users can delete credentials at any time via Settings page
- Deletion is immediate and permanent

---

## 3. Custodial Wallet Control (Optional)

### ⚠️ High Risk Feature

Custodial mode allows the server to execute DEX trades without user signature. This is **opt-in only** and requires explicit consent.

### Consent Requirements
1. User must type confirmation phrase: `"I UNDERSTAND THE RISKS"`
2. Explicit checkbox acknowledgment
3. Warning displayed about risks

### Private Key Storage
- Private keys encrypted using libsodium/AES-256-GCM
- Unique IV per key
- Encryption key stored in server environment (`CUSTODIAL_WALLET_KEY`)
- Key material **never** logged

### Revocation
- Users can revoke custodial access at any time
- Revocation sets `revoked_at` timestamp
- Revoked wallets cannot be used for AUTO execution
- Users can request full key deletion

### Audit Logging
All custodial actions are logged to `audit_log` table:
- Action type (ENABLE, REVOKE, TRADE)
- Timestamp
- Success/failure
- Error reason if applicable
- IP address and user agent

---

## 4. Execution Safety

### Kill Switch
- Global kill switch stops ALL trade execution
- Enforced **server-side** in execution service
- Cannot be bypassed from frontend

### Risk Limits
Risk limits are enforced server-side before any execution:
- `max_order_usdt` — Maximum single trade size
- `max_daily_usdt` — Daily volume limit
- `min_edge_bps` — Minimum edge required
- `max_slippage_bps` — Maximum allowed slippage

### Execution Modes
1. **PAPER** — Simulation only, no real trades
2. **MANUAL** — User signs DEX tx, CEX via API
3. **AUTO** — Server executes both legs (requires custodial wallet)

---

## 5. Data Protection

### What We Store
- User email (from Supabase Auth)
- Wallet addresses (public)
- Exchange API keys (encrypted)
- Risk limit preferences
- Trade history
- Market snapshots

### What We Never Store
- Passwords (magic link auth)
- Plaintext private keys
- Session tokens (JWT only)

### Data Access
- All queries filtered by `user_id`
- RLS policies prevent cross-user access
- Service role used only for backend operations

---

## 6. External API Security

### Server-Side Only
All sensitive API calls are made server-side:
- Etherscan (transaction history)
- LBank/LATOKEN (trading APIs)
- Uniswap RPC (quote fetching)

### Rate Limiting & Caching
- 30-second cache for transaction data
- Exponential backoff for retries
- Never expose API keys to frontend

---

## 7. Infrastructure

### Production Environment
- VPS hosted on Vultr Amsterdam
- HTTPS only via Let's Encrypt SSL
- Nginx reverse proxy
- PM2 process manager

### Secrets Management
- Production secrets in VPS environment variables
- `.env` files for local development only
- `.env` files gitignored

---

## 8. Incident Response

### If You Suspect Compromise
1. Enable kill switch immediately
2. Revoke custodial wallet access
3. Rotate CEX API keys on exchange websites
4. Contact support

### Reporting
Report security issues to: security@depollutenow.com

---

## 9. Limitations & Disclaimers

### Not Financial Advice
This platform provides tools for market monitoring and trade execution. Users are responsible for their own trading decisions.

### Custodial Risk
By enabling custodial mode, you grant the server control over your wallet's funds. Only deposit what you can afford to lose.

### No Guarantees
We do not guarantee profit, uptime, or protection against market conditions or smart contract failures.

---

## 10. Compliance Checklist

| Control | Status |
|---------|--------|
| RLS on all user tables | ✅ |
| Secrets encrypted at rest | ✅ |
| Kill switch server-enforced | ✅ |
| Risk limits server-enforced | ✅ |
| Audit logging for custodial | ✅ |
| No plaintext key storage | ✅ |
| HTTPS only in production | ✅ |
| JWT verification on all endpoints | ✅ |

---

*Last updated: December 2024*
