import { ethers } from 'ethers';

// Uniswap V4 Universal Router address on Ethereum mainnet
const UNIVERSAL_ROUTER_ADDRESS = '0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD';

// Token addresses
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const CSR_ADDRESS = '0x75Ecb52e403C617679FBd3e77A50f9d10A842387';
const CSR25_ADDRESS = '0x502e7230e142a332dfed1095f7174834b2548982';

// ERC20 ABI for approval
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
  'function decimals() external view returns (uint8)',
];

// Uniswap Universal Router ABI (simplified for execute)
const UNIVERSAL_ROUTER_ABI = [
  'function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable',
];

export interface SwapParams {
  tokenIn: 'USDT' | 'CSR' | 'CSR25';
  tokenOut: 'USDT' | 'CSR' | 'CSR25';
  amountIn: string; // in token units (e.g., "100" for 100 USDT)
  slippageBps: number; // e.g., 50 for 0.5%
}

export interface SwapResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

function getTokenAddress(token: 'USDT' | 'CSR' | 'CSR25'): string {
  switch (token) {
    case 'USDT': return USDT_ADDRESS;
    case 'CSR': return CSR_ADDRESS;
    case 'CSR25': return CSR25_ADDRESS;
  }
}

function getTokenDecimals(token: 'USDT' | 'CSR' | 'CSR25'): number {
  return token === 'USDT' ? 6 : 18;
}

export async function checkTokenBalance(
  signer: ethers.Signer,
  token: 'USDT' | 'CSR' | 'CSR25'
): Promise<string> {
  const tokenAddress = getTokenAddress(token);
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const address = await signer.getAddress();
  const balance = await contract.balanceOf(address);
  const decimals = getTokenDecimals(token);
  return ethers.utils.formatUnits(balance, decimals);
}

export async function approveToken(
  signer: ethers.Signer,
  token: 'USDT' | 'CSR' | 'CSR25',
  amount: string
): Promise<{ success: boolean; txHash?: string; error?: string }> {
  try {
    const tokenAddress = getTokenAddress(token);
    const decimals = getTokenDecimals(token);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
    
    const amountWei = ethers.utils.parseUnits(amount, decimals);
    const tx = await contract.approve(UNIVERSAL_ROUTER_ADDRESS, amountWei);
    await tx.wait();
    
    return { success: true, txHash: tx.hash };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Approval failed';
    return { success: false, error: message };
  }
}

export async function executeSwap(
  signer: ethers.Signer,
  params: SwapParams
): Promise<SwapResult> {
  try {
    // For now, show that this requires the Universal Router integration
    // Full implementation requires encoding the swap commands properly
    
    const tokenInAddress = getTokenAddress(params.tokenIn);
    const tokenOutAddress = getTokenAddress(params.tokenOut);
    const decimalsIn = getTokenDecimals(params.tokenIn);
    
    // Check balance first
    const balance = await checkTokenBalance(signer, params.tokenIn);
    const amountInFloat = parseFloat(params.amountIn);
    
    if (parseFloat(balance) < amountInFloat) {
      return {
        success: false,
        error: `Insufficient ${params.tokenIn} balance. Have: ${balance}, Need: ${params.amountIn}`,
      };
    }

    // NOTE: Full Uniswap V4 swap implementation requires:
    // 1. Encoding the swap path through the pool
    // 2. Using the Universal Router's execute function
    // 3. Handling the V4 hook system
    
    // For safety, we return a placeholder that explains what would happen
    return {
      success: false,
      error: `Swap simulation: Would swap ${params.amountIn} ${params.tokenIn} for ${params.tokenOut}.\n\n` +
             `Token In: ${tokenInAddress}\n` +
             `Token Out: ${tokenOutAddress}\n` +
             `Amount: ${ethers.utils.parseUnits(params.amountIn, decimalsIn).toString()} wei\n\n` +
             `Full execution requires Universal Router integration. Contact developer to enable.`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Swap failed';
    return { success: false, error: message };
  }
}

export function useUniswapSwap() {
  return {
    checkTokenBalance,
    approveToken,
    executeSwap,
    USDT_ADDRESS,
    CSR_ADDRESS,
    CSR25_ADDRESS,
    UNIVERSAL_ROUTER_ADDRESS,
  };
}
