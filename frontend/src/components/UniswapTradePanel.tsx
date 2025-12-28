import { useState } from "react";

// HARDCODED Uniswap swap URLs per token - VERIFIED CORRECT
const UNISWAP_URLS = {
  CSR: "https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0xdAC17F958D2ee523a2206206994597C13D831ec7&outputCurrency=0x75Ecb52e403C617679FBd3e77A50f9d10A842387",
  CSR25:
    "https://app.uniswap.org/swap?chain=mainnet&inputCurrency=0xdAC17F958D2ee523a2206206994597C13D831ec7&outputCurrency=0x502E7230E142A332DFEd1095F7174834b2548982",
} as const;

interface UniswapTradePanelProps {
  token: "CSR" | "CSR25";
  direction: "buy" | "sell";
  dexPrice: number;
  cexPrice: number;
  recommendedAmount?: number;
}

export function UniswapTradePanel({
  token,
  direction,
  dexPrice,
  cexPrice,
  recommendedAmount,
}: UniswapTradePanelProps) {
  // Use recommended amount as default, fall back to 100
  const [amount, setAmount] = useState(recommendedAmount?.toString() || "100");

  const inputToken = direction === "buy" ? "USDT" : token;
  const outputToken = direction === "buy" ? token : "USDT";

  // Calculate estimated output based on DEX price
  const estimatedOutput =
    direction === "buy"
      ? dexPrice > 0
        ? (parseFloat(amount) / dexPrice).toFixed(2)
        : "—"
      : (parseFloat(amount) * dexPrice).toFixed(4);

  // Calculate spread
  const spread =
    cexPrice > 0 ? (((dexPrice - cexPrice) / cexPrice) * 100).toFixed(2) : "0";

  // Build URL with amount pre-filled
  // Uniswap uses exactAmount parameter for v3/v4 interface
  const baseUrl = UNISWAP_URLS[token];
  const uniswapUrl = `${baseUrl}&exactField=input&exactAmount=${amount}`;

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-3">
        {direction === "buy" ? "🟢 Buy" : "🔴 Sell"} {token} on Uniswap
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
          <span
            className={`ml-2 ${
              parseFloat(spread) > 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {spread}%
          </span>
        </div>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="text-gray-400 text-sm mb-1 block">
          Amount ({inputToken})
        </label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-full bg-gray-900 text-white px-3 py-2 rounded border border-gray-700 focus:border-blue-500 focus:outline-none"
          placeholder="100"
        />
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

      {/* Single action: Open in Uniswap */}
      <a
        href={uniswapUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full bg-pink-600 hover:bg-pink-500 text-white py-3 rounded-lg font-semibold text-center transition-colors"
      >
        Open in Uniswap to Review & Execute ↗
      </a>

      {/* Info - NO internal approve flow */}
      <div className="mt-4 text-xs text-gray-500 space-y-1">
        <p>• Clicking "Open in Uniswap" opens the official Uniswap interface</p>
        <p>• You'll see the real quote with gas fees and price impact</p>
        <p>• Approve and execute the trade directly on Uniswap</p>
      </div>
    </div>
  );
}
