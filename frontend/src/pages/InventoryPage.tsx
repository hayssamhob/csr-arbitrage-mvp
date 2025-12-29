/**
 * InventoryPage - Balances & Risk Management
 * 
 * Shows:
 * - Balances across: Wallet + LBank + LATOKEN
 * - Exposure limits
 * - Current open positions
 */

import { useEffect, useState } from "react";
import { Footer } from "../components/Footer";
import { useAuth } from "../contexts/AuthContext";
import { useWallet } from "../hooks/useWallet";

const API_URL = import.meta.env.VITE_API_URL || "";

interface RecentTransaction {
  hash: string;
  type: string;
  amount: string;
  token: string;
  timestamp: string;
  status: "confirmed" | "pending";
}

interface VenueBalance {
  venue: string;
  asset: string;
  available: number;
  locked: number;
  total: number;
  usd_value: number;
}

interface ExchangeStatus {
  connected: boolean;
  error: string | null;
}

interface InventoryState {
  balances: VenueBalance[];
  total_usd: number;
  exchange_statuses: Record<string, ExchangeStatus>;
  exposure: {
    max_per_trade_usd: number;
    max_daily_usd: number;
    used_daily_usd: number;
  };
  last_update: string;
  saved_wallet_address: string | null;
}

// Cache for inventory data to avoid reloading on every page visit
let inventoryCache: InventoryState | null = null;
let lastFetchTime = 0;
const CACHE_DURATION_MS = 30000; // 30 seconds

export function InventoryPage() {
  const { user, getAccessToken } = useAuth();
  const wallet = useWallet();

  // Initialize from cache if available
  const [state, setState] = useState<InventoryState>(() => {
    if (inventoryCache) return inventoryCache;
    return {
      balances: [],
      total_usd: 0,
      exchange_statuses: {},
      exposure: {
        max_per_trade_usd: 1000,
        max_daily_usd: 10000,
        used_daily_usd: 0,
      },
      last_update: "",
      saved_wallet_address: null,
    };
  });

  // Only show loading if we have no cached data
  const [loading, setLoading] = useState(!inventoryCache);
  const [error, setError] = useState<string | null>(null);
  const [recentTxs, setRecentTxs] = useState<RecentTransaction[]>([]);
  const [loadingTxs, setLoadingTxs] = useState(false);

  useEffect(() => {
    if (user) {
      // Fetch if no cache or cache is stale
      const now = Date.now();
      if (!inventoryCache || now - lastFetchTime > CACHE_DURATION_MS) {
        fetchBalances();
      }
      // Set up periodic refresh in background
      const interval = setInterval(
        () => fetchBalances(true),
        CACHE_DURATION_MS
      );
      return () => clearInterval(interval);
    } else {
      setLoading(false);
    }
  }, [user]);

  // Fetch recent transactions when wallet is connected OR saved
  useEffect(() => {
    const addressToUse = wallet.address || state.saved_wallet_address;
    if (addressToUse) {
      fetchRecentTransactions(addressToUse);
    }
  }, [wallet.address, state.saved_wallet_address]);

  const fetchRecentTransactions = async (address: string) => {
    setLoadingTxs(true);
    try {
      // Fetch from Etherscan API (free tier)
      const apiKey = "YourApiKeyToken"; // Free tier works without key for limited calls
      const response = await fetch(
        `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&startblock=0&endblock=99999999&page=1&offset=10&sort=desc&apikey=${apiKey}`
      );
      const data = await response.json();

      if (data.status === "1" && Array.isArray(data.result)) {
        const txs: RecentTransaction[] = data.result
          .slice(0, 5)
          .map((tx: any) => ({
            hash: tx.hash,
            type:
              tx.from.toLowerCase() === address.toLowerCase()
                ? "transfer"
                : "receive",
            amount: (parseFloat(tx.value) / 1e18).toFixed(4),
            token: "ETH",
            timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
            status: tx.txreceipt_status === "1" ? "confirmed" : "pending",
          }));
        setRecentTxs(txs);
      }
    } catch (err) {
      console.error("Failed to fetch transactions:", err);
    }
    setLoadingTxs(false);
  };

  const fetchBalances = async (background = false) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/api/me/balances`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        const newState: InventoryState = {
          balances: data.balances || [],
          total_usd: data.total_usd || 0,
          exchange_statuses: data.exchange_statuses || {},
          exposure: data.exposure || {
            max_per_trade_usd: 1000,
            max_daily_usd: 10000,
            used_daily_usd: 0,
          },
          last_update: data.last_update || new Date().toISOString(),
          saved_wallet_address: data.saved_wallet_address || null,
        };
        setState(newState);
        // Update cache
        inventoryCache = newState;
        lastFetchTime = Date.now();
      } else {
        const errData = await res.json();
        if (!background) setError(errData.error || "Failed to fetch balances");
      }
    } catch (err: any) {
      if (!background) setError(err.message || "Network error");
    }
    if (!background) setLoading(false);
  };

  const venues = ["Wallet", "LBank", "LATOKEN"];
  const getVenueBalances = (venue: string) =>
    state.balances.filter((b) => b.venue === venue);
  const getVenueTotal = (venue: string) =>
    state.balances
      .filter((b) => b.venue === venue)
      .reduce((sum, b) => sum + b.usd_value, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading inventory...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-3">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl font-bold">💰 Inventory & Risk</h1>
          <p className="text-slate-400 text-sm">
            Balances across venues and exposure limits
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
            <div className="text-slate-400 text-sm mb-1">Total Value</div>
            <div className="text-2xl font-bold font-mono">
              ${state.total_usd.toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
            <div className="text-slate-400 text-sm mb-1">Max Per Trade</div>
            <div className="text-2xl font-bold font-mono">
              ${state.exposure.max_per_trade_usd}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
            <div className="text-slate-400 text-sm mb-1">Daily Limit</div>
            <div className="text-2xl font-bold font-mono">
              ${state.exposure.max_daily_usd}
            </div>
          </div>
          <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
            <div className="text-slate-400 text-sm mb-1">Used Today</div>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              ${state.exposure.used_daily_usd}
            </div>
            <div className="mt-1 h-1 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{
                  width: `${
                    (state.exposure.used_daily_usd /
                      state.exposure.max_daily_usd) *
                    100
                  }%`,
                }}
              />
            </div>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
            <p className="text-red-400 text-sm">⚠️ {error}</p>
          </div>
        )}

        {/* Connection Required Notice - show only when not logged in or no exchanges configured */}
        {(!user || Object.keys(state.exchange_statuses).length === 0) && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-6 mb-6">
            <div className="flex items-start gap-4">
              <span className="text-2xl">🔗</span>
              <div>
                <h3 className="font-semibold text-amber-400 mb-2">
                  Connect Your Accounts
                </h3>
                <p className="text-slate-400 text-sm mb-3">
                  To view your balances and enable trading, you need to:
                </p>
                <ol className="text-slate-400 text-sm space-y-1 list-decimal list-inside">
                  <li>
                    Sign in with your email (click "Connect" in the navbar)
                  </li>
                  <li>Go to Settings and add your exchange API keys</li>
                  <li>Connect your wallet address</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* Venue Balances */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {venues.map((venue) => (
            <div
              key={venue}
              className="bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>
                    {venue === "Wallet"
                      ? "🔐"
                      : venue === "LBank"
                      ? "🏦"
                      : "🏛️"}
                  </span>
                  <span className="font-semibold">{venue}</span>
                </div>
                <span className="text-sm text-slate-400">
                  ${getVenueTotal(venue).toLocaleString()}
                </span>
              </div>

              <div className="divide-y divide-slate-700/50">
                {getVenueBalances(venue).map((balance, idx) => (
                  <div
                    key={idx}
                    className="px-4 py-3 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{balance.asset}</div>
                      <div className="text-xs text-slate-500">
                        {balance.locked > 0 &&
                          `${balance.locked.toLocaleString()} locked`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono">
                        {balance.available.toLocaleString()}
                      </div>
                      <div className="text-xs text-slate-400">
                        ${balance.usd_value.toFixed(2)}
                      </div>
                    </div>
                  </div>
                ))}
                {getVenueBalances(venue).length === 0 && (
                  <div className="px-4 py-6 text-center text-sm">
                    {venue === "Wallet" ? (
                      wallet.isConnected || state.saved_wallet_address ? (
                        <div>
                          <span className="text-emerald-400">✓ Connected</span>
                          <p className="text-xs text-slate-500 mt-1 font-mono">
                            {(
                              wallet.address || state.saved_wallet_address
                            )?.slice(0, 6)}
                            ...
                            {(
                              wallet.address || state.saved_wallet_address
                            )?.slice(-4)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-500">Not connected</span>
                      )
                    ) : state.exchange_statuses[venue.toLowerCase()]
                        ?.connected ? (
                      <div>
                        <span className="text-emerald-400">✓ Connected</span>
                        {state.exchange_statuses[venue.toLowerCase()]
                          ?.error && (
                          <p className="text-xs text-slate-500 mt-1">
                            {
                              state.exchange_statuses[venue.toLowerCase()]
                                ?.error
                            }
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-500">Not connected</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Risk Limits */}
        <div className="mt-6 bg-slate-900/50 rounded-xl border border-slate-700 p-4">
          <h3 className="font-semibold mb-4">Risk Limits</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm">Max Order Size</div>
              <div className="font-mono text-lg">
                ${state.exposure.max_per_trade_usd}
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm">Max Daily Volume</div>
              <div className="font-mono text-lg">
                ${state.exposure.max_daily_usd}
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm">Min Edge (bps)</div>
              <div className="font-mono text-lg">50</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <div className="text-slate-400 text-sm">Max Slippage (bps)</div>
              <div className="font-mono text-lg">100</div>
            </div>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="mt-6 bg-slate-900/50 rounded-xl border border-slate-700 p-4">
          <h3 className="font-semibold mb-4">Recent Transactions</h3>
          {loadingTxs ? (
            <div className="text-center text-slate-500 py-4">
              Loading transactions...
            </div>
          ) : recentTxs.length > 0 ? (
            <div className="space-y-2">
              {recentTxs.map((tx, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xs px-2 py-1 rounded ${
                        tx.type === "swap"
                          ? "bg-blue-500/20 text-blue-400"
                          : tx.type === "transfer"
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "bg-slate-500/20 text-slate-400"
                      }`}
                    >
                      {tx.type.toUpperCase()}
                    </span>
                    <div>
                      <div className="font-mono text-sm">
                        {tx.amount} {tx.token}
                      </div>
                      <div className="text-xs text-slate-500">
                        {new Date(tx.timestamp).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        tx.status === "confirmed"
                          ? "bg-emerald-500"
                          : "bg-amber-500 animate-pulse"
                      }`}
                    ></span>
                    <a
                      href={`https://etherscan.io/tx/${tx.hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-400 hover:text-white font-mono"
                    >
                      {tx.hash.slice(0, 8)}...
                    </a>
                  </div>
                </div>
              ))}
            </div>
          ) : wallet.isConnected || state.saved_wallet_address ? (
            <div className="text-center text-slate-500 py-4 text-sm">
              No recent transactions found for this wallet
            </div>
          ) : (
            <div className="text-center text-slate-500 py-4 text-sm">
              Connect or save your wallet to view transactions
            </div>
          )}
        </div>

        {/* Last Update */}
        <div className="mt-4 text-center text-slate-500 text-xs">
          Last updated:{" "}
          {state.last_update
            ? new Date(state.last_update).toLocaleString()
            : "—"}
        </div>
      </div>
      <Footer />
    </div>
  );
}
