import React, { useState } from 'react';
import { PRESET_TOKENS } from '../constants/tokens';
import { useUniswapSwap } from '../hooks/useUniswapSwap';
import { useWallet } from '../hooks/useWallet';

export const UniswapTradePanel: React.FC = () => {
  const { isConnected } = useWallet();

  // State for token selection
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<string>(PRESET_TOKENS[0].symbol);
  const [customTokenAddress, setCustomTokenAddress] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [tradeDirection, setTradeDirection] = useState<'buy' | 'sell'>('buy');

  // Derive the active address based on selection
  const activeTokenAddress = React.useMemo(() => {
    if (selectedTokenSymbol === 'CUSTOM') {
      return customTokenAddress;
    }
    const token = PRESET_TOKENS.find(t => t.symbol === selectedTokenSymbol);
    return token ? token.address : '';
  }, [selectedTokenSymbol, customTokenAddress]);

  // Hook for swap logic
  const { executeSwap, isLoading, error, txHash } = useUniswapSwap();

  const handleSwap = async () => {
    if (!activeTokenAddress || !amount) return;
    await executeSwap(amount, activeTokenAddress, tradeDirection);
  };

  return (
    <div className="bg-slate-800 rounded-lg p-6 shadow-lg border border-slate-700">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          🦄 Uniswap Execution
        </h2>
        <div className="text-xs font-mono text-slate-400">
          {isConnected ? 'Wallet Connected' : 'Wallet Disconnected'}
        </div>
      </div>

      {/* Token Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-slate-400 mb-2">Select Token</label>
        <div className="flex gap-2">
          <select
            value={selectedTokenSymbol}
            onChange={(e) => setSelectedTokenSymbol(e.target.value)}
            className="flex-1 bg-slate-900 border border-slate-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
          >
            {PRESET_TOKENS.map((token) => (
              <option key={token.symbol} value={token.symbol}>
                {token.symbol} - {token.name}
              </option>
            ))}
            <option value="CUSTOM">+ Custom Contract</option>
          </select>
        </div>

        {/* Custom Address Input */}
        {selectedTokenSymbol === 'CUSTOM' && (
          <div className="mt-2">
            <input
              type="text"
              placeholder="0x..."
              value={customTokenAddress}
              onChange={(e) => setCustomTokenAddress(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 text-white text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 font-mono"
            />
          </div>
        )}
      </div>

      {/* Trade Direction */}
      <div className="flex bg-slate-900 rounded-lg p-1 mb-4">
        <button
          onClick={() => setTradeDirection('buy')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${tradeDirection === 'buy'
              ? 'bg-green-600 text-white'
              : 'text-slate-400 hover:text-white'
            }`}
        >
          Buy {selectedTokenSymbol !== 'CUSTOM' ? selectedTokenSymbol : 'Token'}
        </button>
        <button
          onClick={() => setTradeDirection('sell')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${tradeDirection === 'sell'
              ? 'bg-red-600 text-white'
              : 'text-slate-400 hover:text-white'
            }`}
        >
          Sell {selectedTokenSymbol !== 'CUSTOM' ? selectedTokenSymbol : 'Token'}
        </button>
      </div>

      {/* Amount Input */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-400 mb-2">
          Amount ({tradeDirection === 'buy' ? 'ETH' : selectedTokenSymbol !== 'CUSTOM' ? selectedTokenSymbol : 'Tokens'})
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-slate-900 border border-slate-600 text-white text-xl rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-3"
        />
      </div>

      {/* Status & Action */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm break-all">
          Error: {error}
        </div>
      )}

      {txHash && (
        <div className="mb-4 p-3 bg-green-900/50 border border-green-700 rounded text-green-200 text-sm break-all">
          Tx Submitted: {txHash}
        </div>
      )}

      <button
        onClick={handleSwap}
        disabled={!isConnected || isLoading || !amount || !activeTokenAddress}
        className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-colors ${!isConnected
            ? 'bg-slate-600 cursor-not-allowed'
            : isLoading
              ? 'bg-blue-800 cursor-wait'
              : tradeDirection === 'buy'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
          }`}
      >
        {!isConnected
          ? 'Connect Wallet First'
          : isLoading
            ? 'Swapping...'
            : `${tradeDirection === 'buy' ? 'Buy' : 'Sell'} ${selectedTokenSymbol !== 'CUSTOM' ? selectedTokenSymbol : 'Token'}`
        }
      </button>
    </div>
  );
};
