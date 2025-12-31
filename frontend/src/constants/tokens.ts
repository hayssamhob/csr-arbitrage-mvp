export interface TokenDefinition {
    symbol: string;
    name: string;
    address: string;
    decimals: number;
}

export const PRESET_TOKENS: TokenDefinition[] = [
  {
    symbol: "CSR",
    name: "CSR Plastic Credit",
    address: "0x75Ecb52e403C617679FBd3e77A50f9d10A842387",
    decimals: 18,
  },
  {
    symbol: "CSR25",
    name: "CSR Year 2025",
    address: "0x502E7230E142A332DFEd1095F7174834b2548982",
    decimals: 18,
  },
  // Future proofing: Easy to add CSR26, CSR27 here
];

// Standard addresses (Ethereum Mainnet)
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
export const USDT_ADDRESS = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

// Uniswap V4 Contract Addresses (from docs.uniswap.org/contracts/v4/deployments)
export const UNISWAP_V4_POOL_MANAGER =
  "0x000000000004444c5dc75cB358380D2e3dE08A90";
export const UNISWAP_V4_STATE_VIEW =
  "0x7ffe42c4a5deea5b0fec41c94c136cf115597227";
export const UNISWAP_V4_QUOTER = "0x52f0e24d1c21c8a0cb1e5a5dd6198556bd9e1203";
export const UNISWAP_V4_UNIVERSAL_ROUTER =
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af";

// Legacy V3 Router (for reference only)
export const UNISWAP_ROUTER_ADDRESS =
  "0xE592427A0AEce92De3Edee1F18E0157C05861564";
