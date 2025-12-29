/**
 * RecentSwaps - Displays recent on-chain swap transactions
 * Fetches from Etherscan API for full token transfer history
 */

import { useEffect, useState } from "react";

interface Swap {
  tx_hash: string;
  block_number: number;
  timestamp: number;
  time_ago: string;
  time_iso: string;
  type: string;
  is_dex_swap: boolean;
  token_amount: number;
  token_amount_formatted: string;
  wallet: string;
  wallet_full: string;
  from: string;
  to: string;
  etherscan_url: string;
}

interface SwapsResponse {
  token: string;
  token_address: string;
  swaps: Swap[];
  cached: boolean;
  cache_age_sec?: number;
  total_transfers?: number;
  dex_swaps?: number;
  error?: string;
}

interface RecentSwapsProps {
  token: "CSR" | "CSR25";
}

export function RecentSwaps({ token }: RecentSwapsProps) {
  const [data, setData] = useState<SwapsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSwaps = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/swaps/${token}`);
        const json = await response.json();

        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
          setError(null);
        }
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchSwaps();
    const interval = setInterval(fetchSwaps, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [token]);

  const shortenTxHash = (hash: string) => {
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
  };

  if (loading && !data) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
        <div className="text-slate-400 text-sm animate-pulse">
          Loading recent transactions...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
        <div className="text-red-400 text-sm">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700">
      <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-slate-400">🔄</span>
          <span className="text-sm font-medium text-slate-300">
            Recent Swaps - {token}
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {data?.cached && (
            <span className="bg-slate-700 px-2 py-0.5 rounded">
              cached {data.cache_age_sec}s
            </span>
          )}
          {data?.dex_swaps !== undefined && <span>{data.dex_swaps} swaps</span>}
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        {data?.swaps && data.swaps.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="bg-slate-900/50 sticky top-0">
              <tr className="text-slate-500">
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Type</th>
                <th className="px-3 py-2 text-right font-medium">{token}</th>
                <th className="px-3 py-2 text-left font-medium">Wallet</th>
                <th className="px-3 py-2 text-left font-medium">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {data.swaps.map((swap, idx) => (
                <tr key={idx} className="hover:bg-slate-700/30">
                  <td className="px-3 py-2 text-slate-400">{swap.time_ago}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        swap.type.startsWith("Buy")
                          ? "bg-emerald-500/20 text-emerald-400"
                          : swap.type.startsWith("Sell")
                          ? "bg-red-500/20 text-red-400"
                          : "bg-slate-500/20 text-slate-400"
                      }`}
                    >
                      {swap.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-300">
                    {swap.token_amount_formatted}
                  </td>
                  <td className="px-3 py-2 font-mono text-slate-400">
                    {swap.wallet}
                  </td>
                  <td className="px-3 py-2">
                    <a
                      href={swap.etherscan_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-400 hover:text-blue-300 hover:underline"
                    >
                      {shortenTxHash(swap.tx_hash)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="px-4 py-6 text-center text-slate-500 text-sm">
            No recent swaps found for {token}
          </div>
        )}
      </div>

      {/* View More on Etherscan Link */}
      {data?.token_address && (
        <div className="px-4 py-3 border-t border-slate-700/50 text-center">
          <a
            href={`https://etherscan.io/token/${data.token_address}?a=0x000000000004444c5dc75cb358380d2e3de08a90`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-400 hover:text-blue-300 hover:underline"
            title="View all Uniswap swaps for this token on Etherscan (filtered by Uniswap Universal Router)"
          >
            View all {token} Uniswap swaps on Etherscan ↗
          </a>
        </div>
      )}
    </div>
  );
}
