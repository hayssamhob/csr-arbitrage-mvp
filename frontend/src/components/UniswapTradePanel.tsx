import { ethers } from 'ethers';
import { useEffect, useState } from 'react';

// Token addresses on Ethereum mainnet
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';
const CSR_ADDRESS = '0x75Ecb52e403C617679FBd3e77A50f9d10A842387';
const CSR25_ADDRESS = '0x502e7230e142a332dfed1095f7174834b2548982';

// Uniswap Swap Router V2 address
const SWAP_ROUTER_ADDRESS = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45';

// ERC20 ABI
const ERC20_ABI = [
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function balanceOf(address account) external view returns (uint256)',
];

interface UniswapTradePanelProps {
  token: 'CSR' | 'CSR25';
  direction: 'buy' | 'sell';
  dexPrice: number;
  cexPrice: number;
  signer: ethers.Signer | null;
  isConnected: boolean;
  onConnect: () => void;
}

export function UniswapTradePanel({
  token,
  direction,
  dexPrice,
  cexPrice,
  signer,
  isConnected,
  onConnect,
}: UniswapTradePanelProps) {
  const [amount, setAmount] = useState('100');
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const tokenAddress = token === 'CSR' ? CSR_ADDRESS : CSR25_ADDRESS;
  const inputToken = direction === 'buy' ? 'USDT' : token;
  const outputToken = direction === 'buy' ? token : 'USDT';
  
  // Calculate estimated output
  const estimatedOutput = direction === 'buy' 
    ? (parseFloat(amount) / dexPrice).toFixed(2)
    : (parseFloat(amount) * dexPrice).toFixed(4);

  // Calculate arbitrage edge
  const spread = ((dexPrice - cexPrice) / cexPrice * 100).toFixed(2);

  // Load balance when wallet connected
  useEffect(() => {
    async function loadBalance() {
      if (!signer) return;
      try {
        const address = await signer.getAddress();
        const inputAddress = direction === 'buy' ? USDT_ADDRESS : tokenAddress;
        const contract = new ethers.Contract(inputAddress, ERC20_ABI, signer);
        const bal = await contract.balanceOf(address);
        const decimals = direction === 'buy' ? 6 : 18;
        setBalance(ethers.utils.formatUnits(bal, decimals));
      } catch (err) {
        console.error('Failed to load balance:', err);
      }
    }
    loadBalance();
  }, [signer, direction, tokenAddress]);

  // Build Uniswap URL with pre-filled parameters
  const buildUniswapUrl = () => {
    const inputAddress = direction === 'buy' ? USDT_ADDRESS : tokenAddress;
    const outputAddress = direction === 'buy' ? tokenAddress : USDT_ADDRESS;
    
    // Use Uniswap's swap interface with pre-filled tokens
    return `https://app.uniswap.org/swap?inputCurrency=${inputAddress}&outputCurrency=${outputAddress}&exactAmount=${amount}&exactField=input`;
  };

  // Handle approve token
  const handleApprove = async () => {
    if (!signer) return;
    setLoading(true);
    setStatus('Approving token...');
    
    try {
      const inputAddress = direction === 'buy' ? USDT_ADDRESS : tokenAddress;
      const decimals = direction === 'buy' ? 6 : 18;
      const contract = new ethers.Contract(inputAddress, ERC20_ABI, signer);
      
      const amountWei = ethers.utils.parseUnits(amount, decimals);
      const tx = await contract.approve(SWAP_ROUTER_ADDRESS, amountWei);
      setStatus('Waiting for confirmation...');
      await tx.wait();
      setStatus('Approved! You can now execute the swap on Uniswap.');
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : 'Approval failed'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-3">
        {direction === 'buy' ? '🟢 Buy' : '🔴 Sell'} {token} on Uniswap
      </h3>

      {/* Price Info */}
      <div className="grid grid-cols-2 gap-2 mb-4 text-sm">
        <div className="bg-gray-900 p-2 rounded">
          <span className="text-gray-400">DEX Price:</span>
          <span className="text-white ml-2">${dexPrice.toFixed(6)}</span>
        </div>
        <div className="bg-gray-900 p-2 rounded">
          <span className="text-gray-400">CEX Price:</span>
          <span className="text-white ml-2">${cexPrice.toFixed(6)}</span>
        </div>
        <div className="col-span-2 bg-gray-900 p-2 rounded">
          <span className="text-gray-400">Spread:</span>
          <span className={`ml-2 ${parseFloat(spread) > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {spread}%
          </span>
        </div>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="text-gray-400 text-sm mb-1 block">
          Amount ({inputToken})
        </label>
        <div className="flex gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="flex-1 bg-gray-900 text-white px-3 py-2 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
            placeholder="100"
          />
          {balance && (
            <button
              onClick={() => setAmount(balance)}
              className="text-blue-400 text-sm px-2 hover:text-blue-300"
            >
              Max
            </button>
          )}
        </div>
        {balance && (
          <div className="text-gray-500 text-xs mt-1">
            Balance: {parseFloat(balance).toFixed(4)} {inputToken}
          </div>
        )}
      </div>

      {/* Estimated Output */}
      <div className="bg-gray-900 p-3 rounded mb-4">
        <div className="text-gray-400 text-sm">Estimated Output</div>
        <div className="text-white text-xl font-bold">
          {estimatedOutput} {outputToken}
        </div>
        <div className="text-gray-500 text-xs">
          Based on current DEX price (actual may vary)
        </div>
      </div>

      {/* Actions */}
      {!isConnected ? (
        <button
          onClick={onConnect}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-lg font-semibold"
        >
          Connect Wallet
        </button>
      ) : (
        <div className="space-y-2">
          <button
            onClick={handleApprove}
            disabled={loading}
            className="w-full bg-yellow-600 hover:bg-yellow-500 text-white py-2 rounded-lg font-semibold disabled:opacity-50"
          >
            {loading ? 'Processing...' : `1. Approve ${inputToken}`}
          </button>
          
          <a
            href={buildUniswapUrl()}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full bg-pink-600 hover:bg-pink-500 text-white py-3 rounded-lg font-semibold text-center"
          >
            2. Execute on Uniswap ↗
          </a>
        </div>
      )}

      {/* Status */}
      {status && (
        <div className="mt-3 p-2 bg-gray-900 rounded text-sm text-gray-300">
          {status}
        </div>
      )}

      {/* Info */}
      <div className="mt-4 text-xs text-gray-500">
        <p>• Clicking "Execute on Uniswap" opens the official Uniswap interface</p>
        <p>• You'll see the real quote with gas fees and price impact</p>
        <p>• The trade executes through your connected wallet</p>
      </div>
    </div>
  );
}
