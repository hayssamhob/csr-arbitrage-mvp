import { ethers } from "ethers";
import { useState } from "react";
import { UNISWAP_V4_UNIVERSAL_ROUTER, USDT_ADDRESS } from "../constants/tokens";

// Uniswap V4 Universal Router ABI (execute function)
const UNIVERSAL_ROUTER_ABI = [
  "function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable returns (bytes[] memory outputs)",
];

// Minimal ABI for ERC20 Approve
const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

// V4 PoolKey structure for CSR/USDT pools (discovered by quote service)
interface PoolKey {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

// Default pool parameters from discovery (can be updated dynamically)
const DEFAULT_POOL_KEY: PoolKey = {
  currency0: "", // Set dynamically based on token sorting
  currency1: "",
  fee: 3000, // 0.3% - most common
  tickSpacing: 60,
  hooks: ethers.constants.AddressZero,
};

export const useUniswapSwap = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Sort currencies numerically for V4 (currency0 < currency1)
  const sortCurrencies = (tokenA: string, tokenB: string): [string, string] => {
    const a = ethers.BigNumber.from(tokenA);
    const b = ethers.BigNumber.from(tokenB);
    return a.lt(b) ? [tokenA, tokenB] : [tokenB, tokenA];
  };

  // Execute swap via V4 Universal Router
  const executeSwap = async (
    amount: string,
    tokenAddress: string,
    direction: "buy" | "sell",
    poolKey?: Partial<PoolKey>
  ) => {
    setIsLoading(true);
    setError(null);
    setTxHash(null);

    try {
      if (!window.ethereum) throw new Error("No crypto wallet found");

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = provider.getSigner();
      const userAddress = await signer.getAddress();

      // Use USDT as quote currency (matching the V4 pools we discovered)
      const quoteToken = USDT_ADDRESS;
      const [currency0, currency1] = sortCurrencies(tokenAddress, quoteToken);
      const zeroForOne =
        direction === "sell"
          ? tokenAddress.toLowerCase() === currency0.toLowerCase()
          : tokenAddress.toLowerCase() !== currency0.toLowerCase();

      // Build pool key
      const pool: PoolKey = {
        currency0,
        currency1,
        fee: poolKey?.fee || DEFAULT_POOL_KEY.fee,
        tickSpacing: poolKey?.tickSpacing || DEFAULT_POOL_KEY.tickSpacing,
        hooks: poolKey?.hooks || DEFAULT_POOL_KEY.hooks,
      };

      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
      const router = new ethers.Contract(
        UNISWAP_V4_UNIVERSAL_ROUTER,
        UNIVERSAL_ROUTER_ABI,
        signer
      );

      // Get token decimals
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        signer
      );
      const decimals = await tokenContract.decimals();
      const amountIn = ethers.utils.parseUnits(amount, decimals);

      // Approve Universal Router to spend tokens
      const currentAllowance = await tokenContract.allowance(
        userAddress,
        UNISWAP_V4_UNIVERSAL_ROUTER
      );
      if (currentAllowance.lt(amountIn)) {
        console.log("[Swap] Approving Universal Router...");
        const approvalTx = await tokenContract.approve(
          UNISWAP_V4_UNIVERSAL_ROUTER,
          amountIn
        );
        await approvalTx.wait();
        console.log("[Swap] Approval confirmed");
      }

      // Build Universal Router commands for V4 swap
      // Command 0x00 = V4_SWAP
      const commands = "0x00";

      // Encode V4 swap parameters
      const swapParams = ethers.utils.defaultAbiCoder.encode(
        [
          "tuple(address,address,uint24,int24,address)",
          "bool",
          "uint128",
          "uint128",
          "bytes",
        ],
        [
          [
            pool.currency0,
            pool.currency1,
            pool.fee,
            pool.tickSpacing,
            pool.hooks,
          ],
          zeroForOne,
          amountIn,
          0, // amountOutMinimum - in production, calculate from quote!
          "0x", // hookData
        ]
      );

      console.log("[Swap] Executing V4 swap...", {
        pool,
        direction,
        zeroForOne,
        amountIn: amountIn.toString(),
      });

      const tx = await router.execute(commands, [swapParams], deadline);
      setTxHash(tx.hash);

      console.log("[Swap] Transaction submitted:", tx.hash);
      await tx.wait();
      console.log("[Swap] Transaction confirmed");
    } catch (err) {
      console.error("[Swap] Error:", err);
      const error = err as { reason?: string; message?: string };
      setError(error.reason || error.message || "Swap failed");
    } finally {
      setIsLoading(false);
    }
  };

  return { executeSwap, isLoading, error, txHash };
};
