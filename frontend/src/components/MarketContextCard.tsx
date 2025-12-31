/**
 * MarketContextCard - Secondary UI Component (Collapsed by Default)
 * 
 * Shows detailed market context:
 * - CEX Snapshot (Bid/Ask/Mid, Volume, Source)
 * - DEX Snapshot (Execution price, Gas, Slippage)
 */

import { formatPrice } from "../lib/alignmentEngine";

// Trading links for each token
const TRADING_LINKS = {
  CSR: {
    cex: {
      name: "LATOKEN",
      url: "https://latoken.com/exchange/CSR_USDT",
    },
    dex: {
      name: "Uniswap Pool",
      url: "https://app.uniswap.org/explore/pools/ethereum/0x6c76bb9f364e72fcb57819d2920550768cf43e09e819daa40fabe9c7ab057f9e",
    },
  },
  CSR25: {
    cex: {
      name: "LBank",
      url: "https://www.lbank.com/trade/csr25_usdt",
    },
    dex: {
      name: "Uniswap Pool",
      url: "https://app.uniswap.org/explore/pools/ethereum/0x46afcc847653fa391320b2bde548c59cf384b029933667c541fb730c5641778e",
    },
  },
};

interface CexData {
  bid: number;
  ask: number;
  last: number;
  volume24h: number;
  source: string;
  timestamp: string;
}

interface DexData {
  executionPrice: number;
  gasEstimateUsdt: number | null; // null if not scraped
  quoteSize: number;
  source: string;
  timestamp: string;
}

interface MarketContextCardProps {
  token: "CSR" | "CSR25";
  cexData: CexData | null;
  dexData: DexData | null;
  defaultExpanded?: boolean;
}

export function MarketContextCard({
  token,
  cexData,
  dexData,
}: MarketContextCardProps) {

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-xl bg-slate-800/50 flex items-center justify-center">
          <span className="text-sm">📊</span>
        </div>
        <div>
          <span className="text-sm font-bold text-slate-200 block">
            Market Context
          </span>
          <span className="text-[10px] text-slate-500 font-medium">
            {token}
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {/* CEX Snapshot */}
        <div className="bg-slate-950/30 rounded-2xl p-4 border border-slate-800/30">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              CEX
            </span>
            <a
              href={TRADING_LINKS[token].cex.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 transition-colors flex items-center gap-1"
            >
              {TRADING_LINKS[token].cex.name}
              <span className="text-emerald-500/50">↗</span>
            </a>
          </div>

          {cexData ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Bid</span>
                <span className="font-mono text-sm font-bold text-emerald-400">
                  ${formatPrice(cexData.bid)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Ask</span>
                <span className="font-mono text-sm font-bold text-red-400">
                  ${formatPrice(cexData.ask)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Last</span>
                <span className="font-mono text-sm font-bold text-slate-300">
                  ${formatPrice(cexData.last)}
                </span>
              </div>
              <div className="pt-3 mt-3 border-t border-slate-800/50">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Vol 24h</span>
                  <span className="font-mono text-xs text-slate-400">
                    {cexData.volume24h.toLocaleString()}
                  </span>
                </div>
                <div className="text-[10px] text-slate-600 text-right mt-2">
                  {cexData.timestamp}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-xl bg-slate-800/50 mx-auto mb-2 flex items-center justify-center">
                <span className="text-slate-600">—</span>
              </div>
              <span className="text-xs text-slate-600">No CEX data</span>
            </div>
          )}
        </div>

        {/* DEX Snapshot */}
        <div className="bg-slate-950/30 rounded-2xl p-4 border border-slate-800/30">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              DEX
            </span>
            <a
              href={TRADING_LINKS[token].dex.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-bold text-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1"
            >
              Uniswap
              <span className="text-blue-500/50">↗</span>
            </a>
          </div>

          {dexData ? (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Exec Price</span>
                <span className="font-mono text-sm font-bold text-blue-400">
                  ${formatPrice(dexData.executionPrice)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-500">Quote Size</span>
                <span className="font-mono text-sm font-bold text-slate-300">
                  ${dexData.quoteSize}
                </span>
              </div>
              {dexData.gasEstimateUsdt !== null && (
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">Gas Est.</span>
                  <span className="font-mono text-sm font-bold text-slate-400">
                    ${dexData.gasEstimateUsdt.toFixed(2)}
                  </span>
                </div>
              )}
              <div className="pt-3 mt-3 border-t border-slate-800/50">
                <div className="text-[10px] text-slate-600 text-right">
                  {dexData.timestamp}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="w-10 h-10 rounded-xl bg-slate-800/50 mx-auto mb-2 flex items-center justify-center">
                <span className="text-slate-600">—</span>
              </div>
              <span className="text-xs text-slate-600">No DEX data</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
