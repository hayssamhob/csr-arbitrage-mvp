import { ethers } from 'ethers';
import { useCallback, useEffect, useState } from "react";

// Extend Window interface for ethereum (works with MetaMask, Rabby, and other EIP-1193 wallets)
declare global {
  interface Window {
    ethereum?: {
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
      on: (event: string, callback: (...args: unknown[]) => void) => void;
      removeListener: (
        event: string,
        callback: (...args: unknown[]) => void
      ) => void;
      isMetaMask?: boolean;
      isRabby?: boolean;
      isCoinbaseWallet?: boolean;
      providers?: Array<{
        isMetaMask?: boolean;
        isRabby?: boolean;
        isCoinbaseWallet?: boolean;
        request: (args: {
          method: string;
          params?: unknown[];
        }) => Promise<unknown>;
      }>;
    };
  }
}

interface WalletState {
  address: string | null;
  chainId: number | null;
  balance: string | null;
  isConnecting: boolean;
  error: string | null;
  walletName: string | null;
}

export function useWallet() {
  const [state, setState] = useState<WalletState>({
    address: null,
    chainId: null,
    balance: null,
    isConnecting: false,
    error: null,
    walletName: null,
  });

  const [provider, setProvider] =
    useState<ethers.providers.Web3Provider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);

  // Check if any EIP-1193 wallet is available (MetaMask, Rabby, etc.)
  const isWalletAvailable =
    typeof window !== "undefined" && typeof window.ethereum !== "undefined";

  // Detect wallet name
  const getWalletName = (): string => {
    if (!window.ethereum) return "Unknown";
    if (window.ethereum.isRabby) return "Rabby";
    if (window.ethereum.isMetaMask) return "MetaMask";
    if (window.ethereum.isCoinbaseWallet) return "Coinbase";
    return "Wallet";
  };

  // Connect wallet - works with any EIP-1193 compatible wallet
  const connect = useCallback(async () => {
    if (!isWalletAvailable) {
      setState((prev) => ({
        ...prev,
        error: "No wallet detected. Please install MetaMask or Rabby.",
      }));
      return;
    }

    setState((prev) => ({ ...prev, isConnecting: true, error: null }));

    try {
      // Handle multiple wallet providers (e.g., when both Rabby and MetaMask are installed)
      let ethereum = window.ethereum!;

      // If there are multiple providers, try to find Rabby or use first available
      if (ethereum.providers && ethereum.providers.length > 0) {
        const rabbyProvider = ethereum.providers.find((p) => p.isRabby);
        const metaMaskProvider = ethereum.providers.find(
          (p) => p.isMetaMask && !p.isRabby
        );
        ethereum = (rabbyProvider ||
          metaMaskProvider ||
          ethereum.providers[0]) as typeof ethereum;
      }

      // Request account access - this triggers the wallet popup
      const accounts = (await ethereum.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!accounts || accounts.length === 0) {
        throw new Error(
          "No accounts returned. Please unlock your wallet and try again."
        );
      }

      // Create provider and signer using the injected ethereum object
      const web3Provider = new ethers.providers.Web3Provider(
        ethereum as ethers.providers.ExternalProvider,
        "any"
      );
      const web3Signer = web3Provider.getSigner();
      const address = await web3Signer.getAddress();
      const network = await web3Provider.getNetwork();
      const balance = await web3Provider.getBalance(address);
      const walletName = getWalletName();

      setProvider(web3Provider);
      setSigner(web3Signer);

      setState({
        address,
        chainId: network.chainId,
        balance: ethers.utils.formatEther(balance),
        isConnecting: false,
        error: null,
        walletName,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to connect wallet";
      setState((prev) => ({
        ...prev,
        isConnecting: false,
        error: message,
      }));
    }
  }, [isWalletAvailable]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    setProvider(null);
    setSigner(null);
    setState({
      address: null,
      chainId: null,
      balance: null,
      isConnecting: false,
      error: null,
      walletName: null,
    });
  }, []);

  // Listen for account changes
  useEffect(() => {
    if (!isWalletAvailable) return;

    const ethereum = window.ethereum!;

    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0] as string[];
      if (accounts.length === 0) {
        disconnect();
      } else if (accounts[0] !== state.address) {
        connect();
      }
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    ethereum.on("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener("accountsChanged", handleAccountsChanged);
      ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [isWalletAvailable, state.address, connect, disconnect]);

  return {
    ...state,
    provider,
    signer,
    isWalletAvailable,
    connect,
    disconnect,
    isConnected: !!state.address,
  };
}
