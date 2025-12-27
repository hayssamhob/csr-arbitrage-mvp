# Uniswap Quote Service Configuration

## Token and Pool Configuration

The service supports both CSR and CSR25 tokens on Ethereum mainnet. Each token has its own Uniswap v4 pool.

### CSR25 Configuration (default)

- Token: `0x502E7230E142A332DFEd1095F7174834b2548982` (18 decimals)
- Pool ID: `0x46afcc847653fa391320b2bde548c59cf384b029933667c541fb730c5641778e`

### CSR Configuration

- Token: `0x75Ecb52e403C617679FBd3e77A50f9d10A842387` (18 decimals)  
- Pool ID: `0x6c76bb9f364e72fcb57819d2920550768cf43e09e819daa40fabe9c7ab057f9e`

## Switching Between Tokens

To switch from CSR25 to CSR:

```bash
# Copy the CSR configuration
cp .env.csr .env

# Restart the service
npm run dev
```

To switch from CSR to CSR25:

```bash
# Copy the CSR25 configuration (default)
cp .env.example .env

# Restart the service
npm run dev
```

## Important Notes

- CSR and CSR25 are distinct tokens with different addresses
- Never use the same address for both tokens
- Pool IDs are 64 characters (32 bytes) - these are NOT contract addresses
- Uniswap v4 pool state reading is not yet implemented
- The service will verify token existence but return "not yet implemented" for pricing

## Current Status

- ✅ Token verification working
- ✅ Correct token addresses configured
- ⏳ Uniswap v4 pool reading (future implementation)
- ❌ No mock data or fake prices
