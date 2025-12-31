/**
 * PriceHistory - Displays DEX-CEX price deviation history chart
 */

import { useEffect, useState } from "react";

interface PriceHistoryPoint {
  ts: string;
  spread_bps: number;
}

interface PriceHistoryResponse {
  market: string;
  points: PriceHistoryPoint[];
  count: number;
}

interface PriceHistoryProps {
  token: "CSR" | "CSR25";
}

export function PriceHistoryChart({ token }: PriceHistoryProps) {
  const [data, setData] = useState<PriceHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Market name conversion
  const market = token === "CSR" ? "csr_usdt" : "csr25_usdt";

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/price-history/${market}`);
        if (!response.ok) {
          throw new Error(`Failed to fetch history: ${response.status}`);
        }
        const json: PriceHistoryResponse = await response.json();
        setData(json.points || []);
        setError(null);
      } catch (e: any) {
        console.error("Error fetching price history:", e);
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
    const interval = setInterval(fetchHistory, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [market]);

  // Helper to get color based on spread
  const getBarColor = (spreadBps: number): string => {
    // Red means DEX price higher than CEX (arbitrage selling on DEX)
    // Green means DEX price lower than CEX (arbitrage buying on DEX)
    return spreadBps > 0 ? "bg-red-500" : "bg-emerald-500";
  };

  if (loading && data.length === 0) {
    return (
      <div className="flex justify-center items-center h-[60px]">
        <div className="w-6 h-6 border-2 border-slate-700 border-t-emerald-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && data.length === 0) {
    return (
      <div className="text-center text-amber-500 text-sm p-2">
        Error loading price history
      </div>
    );
  }

  // If we have no data yet
  if (data.length === 0) {
    return (
      <div className="text-center text-slate-500 text-xs p-2 h-[60px] flex items-center justify-center">
        No price history available yet
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="text-xs text-slate-500 mb-2 flex justify-between">
        <div>Price Deviation History (Last {data.length})</div>
        <div className="font-mono">{Math.abs(data[data.length - 1]?.spread_bps || 0)} bps</div>
      </div>

      <div className="flex items-end h-[50px] gap-1">
        {data.map((point, i) => {
          const absSpread = Math.abs(point.spread_bps);
          const height = Math.min(Math.max(absSpread / 5, 5), 100); // 5bps = 5% height, 500bps = 100% height
          return (
            <div 
              key={i}
              className="flex-1 bg-slate-900/40 rounded-sm flex items-end"
              title={`${new Date(point.ts).toLocaleTimeString()}: ${absSpread.toFixed(0)} bps`}
            >
              <div
                className={`w-full ${getBarColor(point.spread_bps)} rounded-sm`}
                style={{ height: `${height}%` }}
              ></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
