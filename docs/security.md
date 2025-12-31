Security & Financial Integrity Policy
Project: Depollute Now! CSR Arbitrage Engine Classification: INTERNAL / CONFIDENTIAL Last Updated: December 31, 2025

1. Executive Summary & Zero-Trust Mandate
This document defines the security standards, cryptographic key management, and operational protocols for the Depollute Now! trading infrastructure.

Core Philosophy: The system assumes that any single component (frontend, execution server, database) is a hostile environment. Security is enforced via strict compartmentalization, "Verify then Trust" logic, and immutable audit logs.

1. Wallet Architecture & Capital Separation
To mitigate catastrophic risk, we enforce a strict separation between asset storage (Cold) and execution (Hot).

2.1 The Treasury Wallet (Cold Storage)
Role: Long-term storage of accumulated profits and idle capital.

Type: Multi-Signature Wallet (Gnosis Safe) or Hardware Wallet.

Security: Air-gapped / Offline. Keys never touch a server.

Policy: Holds 90% of total AUM. Requires 2-of-3 human signatures to move funds.

2.2 The Execution Wallet (Hot Wallet)
Role: High-frequency trading execution.

Type: EOA (Externally Owned Account) generated specifically for the bot.

Security: Private key injected via Secrets Manager (Doppler/Vault) at runtime.

Policy:

Maximum Balance: Capped at 10% of total AUM.

Auto-Sweep: Profits exceeding the cap are automatically swept to Treasury.

2.3 User Custodial Wallets (Opt-In)
Role: Allows the server to execute trades on behalf of a specific user.

Consent: Requires explicit "I UNDERSTAND THE RISKS" confirmation phrase and checkbox.

Storage: Private keys encrypted using sodium_crypto_secretbox (xsalsa20-poly1305) or AES-256-GCM.

Key Material: Never logged, never cached beyond the milliseconds required for signing.

1. Authentication & Authorization
3.1 Identity Management (Supabase)
Method: Email Magic Link / OTP (No password storage risks).

Session: Short-lived JWT tokens (1 hour).

Verification: All API endpoints validate the JWT signature before processing.

3.2 Data Access Control (RLS)
Database Level: PostgreSQL Row Level Security (RLS) is enabled on all sensitive tables (user_settings, exchange_credentials, orders).

Policy: A user can only SELECT/UPDATE rows where user_id matches their JWT.

Service Role: The Node.js backend uses the Service Role Key strictly for background jobs (Arbitrage Execution), never for user-facing API routes.

1. Secrets & Credential Management
4.1 System Secrets (Infrastructure)
Definition: Database URLs, Redis passwords, Third-party API Keys (Infura, Etherscan).

Storage: Managed via Doppler or AWS Secrets Manager.

Prohibited: No .env files in production. No secrets in Git.

4.2 User Exchange Credentials (CEX API Keys)
Storage: Stored in exchange_credentials table.

Encryption: AES-256-GCM (Authenticated Encryption).

Note: Previous implementations using CBC are to be migrated to GCM.

Key Management: The Master Encryption Key (CEX_SECRETS_KEY) is injected into the server environment RAM at boot. It is never written to disk.

Lifecycle:

User inputs API Key.

Server encrypts and stores.

During trade execution, server decrypts in memory.

Keys are scrubbed from memory immediately after request dispatch.

1. Execution Safety & MEV Protection
5.1 Flashbots Integration (Anti-Sandwich)
Protocol: All Uniswap transactions must be routed through a private RPC (Flashbots Protect).

Benefit: Transactions skip the public mempool, preventing front-running and sandwich attacks.

Failure Mode: If a trade reverts, it is never included in a block, saving gas fees.

5.2 The "Kill Switch"
Scope: Global server-side lock. Stops ALL trade execution immediately.

Triggers:

Manual Admin Override (Dashboard).

Automated Circuit Breaker:

Spread deviation > 10% in 1 minute.

Gas price > 200 Gwei.

Consecutive execution failures > 5.

5.3 Risk Limits (Hard Coded)
Before any transaction is signed, the engine enforces:

MAX_SLIPPAGE_BPS: 50 (0.5%)

MIN_PROFIT_THRESHOLD: $5.00 (cover gas + operations)

MAX_TRADE_SIZE: Defined per user/tier.

1. Infrastructure & OpSec
6.1 Production Environment
Host: Vultr (Amsterdam Region - Low latency to Binance/EU exchanges).

Network:

Nginx Reverse Proxy: Terminates SSL (Let's Encrypt).

Firewall: Only ports 80/443 open. Database/Redis ports closed to public internet.

Containerization: Services run in isolated Docker containers.

6.2 Audit Logging
Immutable Logs: Every trade, error, and custodial action (Enable/Revoke) is logged to the audit_log table.

Fields: timestamp, user_id, action_type, asset_pair, execution_price, tx_hash.

1. Compliance & Privacy
7.1 Data Minimization
We store: Wallet public addresses, Trade history (for tax reporting).

We do NOT store: Plaintext private keys, Passwords, Credit Card info.

7.2 GDPR/Right to Erasure
Users may request full account deletion.

Action: All off-chain data (email, settings) is wiped. On-chain transaction history remains immutable on Ethereum.

1. Incident Response Protocol
IF A COMPROMISE IS SUSPECTED:

ACTIVATE KILL SWITCH: npm run emergency:stop or via Admin Panel.

DRAIN HOT WALLET: Admin executes immediate sweep of Execution Wallet to Cold Storage.

ROTATE KEYS: Revoke old CEX API keys; Generate new System Private Keys.

NOTIFY: Email <security@depollutenow.com> and alert community if funds are at risk.

Authorized by: Depollute Now! Technical Leadership Status: Live & Enforced
