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
  contract_address?: string;
}

interface LiquidityPosition {
  tokenId: string;
  version?: string; // V3 or V4
  token0: { address: string; symbol: string; decimals: number };
  token1: { address: string; symbol: string; decimals: number };
  fee: number;
  liquidity: string;
  tickLower: number;
  tickUpper: number;
  tokensOwed0: string;
  tokensOwed1: string;
  token0_price: number;
  token1_price: number;
  rewards_usd: number;
  poolId?: string; // V4 only
  hooks?: string; // V4 only
}

interface UserWallet {
  id: string;
  address: string;
  label: string;
}

// Helper to get exchange URL for an asset
function getExchangeUrl(venue: string, asset: string): string | null {
  const venueUrls: Record<string, Record<string, string>> = {
    LBank: {
      CSR25: "https://www.lbank.com/trade/csr25_usdt/",
      USDT: "https://www.lbank.com/trade/csr25_usdt/",
    },
    LATOKEN: {
      CSR: "https://latoken.com/exchange/CSR_USDT",
      USDT: "https://latoken.com/exchange/CSR_USDT",
    },
    Wallet: {
      ETH: "https://etherscan.io/token/",
      CSR: "https://etherscan.io/token/0x6bba316c48b49bd1eac44573c5c871ff02958469",
      CSR25:
        "https://etherscan.io/token/0x0f5c78f152152dda52a2ea45b0a8c10733010748",
      USDT: "https://etherscan.io/token/0xdac17f958d2ee523a2206206994597c13d831ec7",
      USDC: "https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    },
  };
  return venueUrls[venue]?.[asset] || null;
}

// Tooltip component
function Tooltip({
  children,
  text,
}: {
  children: React.ReactNode;
  text: string;
}) {
  return (
    <div className="group relative inline-block">
      {children}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-slate-800 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-50 border border-slate-600">
        {text}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
      </div>
    </div>
  );
}

// Clickable value component
function ClickableValue({
  value,
  href,
  prefix = "",
  suffix = "",
  className = "",
  tooltip,
}: {
  value: string | number;
  href?: string | null;
  prefix?: string;
  suffix?: string;
  className?: string;
  tooltip?: string;
}) {
  const content = (
    <span
      className={`font-mono ${className} ${
        href
          ? "hover:text-emerald-400 cursor-pointer underline decoration-dotted underline-offset-2"
          : ""
      }`}
    >
      {prefix}
      {typeof value === "number"
        ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
        : value}
      {suffix}
    </span>
  );

  const wrapped = tooltip ? (
    <Tooltip text={tooltip}>{content}</Tooltip>
  ) : (
    content
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block"
      >
        {wrapped}
      </a>
    );
  }
  return wrapped;
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

  // Liquidity positions and wallet management
  const [lpPositions, setLpPositions] = useState<LiquidityPosition[]>([]);
  const [userWallets, setUserWallets] = useState<UserWallet[]>([]);
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null);
  const [loadingLp, setLoadingLp] = useState(false);
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [newWalletLabel, setNewWalletLabel] = useState("");

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

  // Fetch liquidity positions and user wallets
  useEffect(() => {
    if (user) {
      fetchLiquidityPositions();
      fetchUserWallets();
    }
  }, [user, selectedWallet]);

  const fetchLiquidityPositions = async () => {
    setLoadingLp(true);
    try {
      const token = await getAccessToken();
      const walletParam = selectedWallet ? `?wallet=${selectedWallet}` : "";
      const res = await fetch(
        `${API_URL}/api/me/liquidity-positions${walletParam}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setLpPositions(data.positions || []);
        if (data.wallets?.length > 0 && !selectedWallet) {
          setSelectedWallet(data.selected_wallet);
        }
      }
    } catch (err) {
      console.error("Failed to fetch LP positions:", err);
    }
    setLoadingLp(false);
  };

  const fetchUserWallets = async () => {
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/api/me/wallets`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setUserWallets(data.wallets || []);
      }
    } catch (err) {
      console.error("Failed to fetch wallets:", err);
    }
  };

  const handleAddWallet = async () => {
    if (!newWalletAddress) return;
    try {
      const token = await getAccessToken();
      const res = await fetch(`${API_URL}/api/me/wallets`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          address: newWalletAddress,
          label: newWalletLabel,
        }),
      });
      if (res.ok) {
        setNewWalletAddress("");
        setNewWalletLabel("");
        setShowAddWallet(false);
        fetchUserWallets();
        fetchLiquidityPositions();
      }
    } catch (err) {
      console.error("Failed to add wallet:", err);
    }
  };

  const handleDeleteWallet = async (walletId: string) => {
    if (!confirm("Are you sure you want to remove this wallet?")) return;
    try {
      const token = await getAccessToken();
      await fetch(`${API_URL}/api/me/wallets/${walletId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      fetchUserWallets();
      fetchLiquidityPositions();
    } catch (err) {
      console.error("Failed to delete wallet:", err);
    }
  };

  const [txError, setTxError] = useState<string | null>(null);

  const fetchRecentTransactions = async (address: string) => {
    setLoadingTxs(true);
    setTxError(null);
    try {
      // Use backend endpoint (server-side Etherscan with caching)
      const token = await getAccessToken();
      const response = await fetch(
        `${API_URL}/api/me/transactions?wallet=${address}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP ${response.status}`);
      }

      const data = await response.json();

      if (data.transactions && Array.isArray(data.transactions)) {
        const txs: RecentTransaction[] = data.transactions.map((tx: any) => ({
          hash: tx.hash,
          type:
            tx.kind === "SEND"
              ? "transfer"
              : tx.kind === "RECEIVE"
              ? "receive"
              : "swap",
          amount: tx.amount,
          token: tx.asset,
          timestamp: tx.timestamp,
          status: tx.status,
        }));
        setRecentTxs(txs);
      } else {
        setRecentTxs([]);
      }
    } catch (err: any) {
      console.error("Failed to fetch transactions:", err);
      setTxError(err.message || "Failed to load transactions");
      setRecentTxs([]);
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

  // Don't block rendering - show content with loading indicator instead

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">💰 Inventory</h1>
            <p className="text-slate-400 text-sm">Balances across venues</p>
          </div>
          <div className="flex items-center gap-3">
            {loading && (
              <span className="text-xs text-slate-400 animate-pulse">
                Refreshing...
              </span>
            )}
            <span className="text-xs text-slate-500">
              {state.last_update
                ? `Updated ${new Date(state.last_update).toLocaleTimeString()}`
                : ""}
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Total Value - Simple */}
        <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-slate-400 text-sm mb-1">
                Total Portfolio Value
              </div>
              <div className="text-3xl font-bold font-mono">
                ${state.total_usd.toLocaleString()}
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>Max trade: ${state.exposure.max_per_trade_usd}</div>
              <div>Daily limit: ${state.exposure.max_daily_usd}</div>
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
          {venues.map((venue) => {
            // Determine connection status
            const venueStatus = state.exchange_statuses[venue];
            const hasBalances = getVenueBalances(venue).length > 0;
            const isConnected =
              venue === "Wallet"
                ? wallet.isConnected || !!state.saved_wallet_address
                : venueStatus?.connected;
            const hasError = venueStatus?.error;

            return (
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
                    {/* Status indicator */}
                    <span
                      className={`h-2 w-2 rounded-full ${
                        hasBalances
                          ? "bg-emerald-500"
                          : isConnected
                          ? "bg-yellow-500"
                          : hasError
                          ? "bg-red-500"
                          : "bg-slate-500"
                      }`}
                      title={
                        hasBalances
                          ? "Live"
                          : isConnected
                          ? "Connected (loading)"
                          : hasError
                          ? `Error: ${hasError}`
                          : "Not connected"
                      }
                    ></span>
                  </div>
                  <span className="text-sm font-mono">
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
                        <Tooltip text={`View ${balance.asset} on ${venue}`}>
                          <a
                            href={getExchangeUrl(venue, balance.asset) || "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-medium hover:text-emerald-400 transition-colors"
                          >
                            {balance.asset} ↗
                          </a>
                        </Tooltip>
                        <div className="text-xs text-slate-500">
                          {balance.locked > 0 &&
                            `${balance.locked.toLocaleString()} locked`}
                        </div>
                      </div>
                      <div className="text-right">
                        <ClickableValue
                          value={balance.available}
                          href={getExchangeUrl(venue, balance.asset)}
                          tooltip={`Available balance: ${balance.available.toLocaleString()} ${
                            balance.asset
                          }`}
                        />
                        <div className="text-xs text-slate-400">
                          <ClickableValue
                            value={balance.usd_value.toFixed(2)}
                            prefix="$"
                            tooltip={`USD value based on current market price`}
                            className="text-slate-400"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                  {getVenueBalances(venue).length === 0 && (
                    <div className="px-4 py-6 text-center text-sm">
                      {venue === "Wallet" ? (
                        wallet.isConnected || state.saved_wallet_address ? (
                          <div>
                            <span className="text-emerald-400">
                              ✓ Connected
                            </span>
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
            );
          })}
        </div>

        {/* Wallet Selector */}
        {userWallets.length > 0 && (
          <div className="mt-6 bg-slate-900/50 rounded-xl border border-slate-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">🔐 Wallets</h3>
              <button
                onClick={() => setShowAddWallet(true)}
                className="text-xs px-3 py-1 bg-emerald-600 hover:bg-emerald-500 rounded-lg"
              >
                + Add Wallet
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {userWallets.map((w) => (
                <div
                  key={w.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                    selectedWallet === w.address
                      ? "bg-emerald-600/30 border border-emerald-500"
                      : "bg-slate-800 hover:bg-slate-700 border border-slate-700"
                  }`}
                  onClick={() => setSelectedWallet(w.address)}
                >
                  <span className="text-sm font-medium">
                    {w.label ||
                      `${w.address.slice(0, 6)}...${w.address.slice(-4)}`}
                  </span>
                  <a
                    href={`https://etherscan.io/address/${w.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 hover:text-white"
                    onClick={(e) => e.stopPropagation()}
                  >
                    ↗
                  </a>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteWallet(w.id);
                    }}
                    className="text-slate-400 hover:text-red-400 ml-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Add Wallet Modal */}
        {showAddWallet && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-slate-900 rounded-xl border border-slate-700 p-6 max-w-md w-full mx-4">
              <h3 className="text-lg font-bold mb-4">Add Wallet</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Wallet Address
                  </label>
                  <input
                    type="text"
                    value={newWalletAddress}
                    onChange={(e) => setNewWalletAddress(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Label (optional)
                  </label>
                  <input
                    type="text"
                    value={newWalletLabel}
                    onChange={(e) => setNewWalletLabel(e.target.value)}
                    placeholder="My Trading Wallet"
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowAddWallet(false)}
                  className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddWallet}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500"
                >
                  Add Wallet
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Liquidity Pool Positions */}
        {lpPositions.length > 0 && (
          <div className="mt-6 bg-slate-900/50 rounded-xl border border-slate-700 p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">
                🌊 Uniswap V3 Liquidity Positions
              </h3>
              <span className="text-sm text-slate-400">
                {lpPositions.length} position{lpPositions.length > 1 ? "s" : ""}
              </span>
            </div>
            {loadingLp ? (
              <div className="text-center text-slate-500 py-4">
                Loading LP positions...
              </div>
            ) : (
              <div className="space-y-4">
                {lpPositions.map((pos) => (
                  <div
                    key={pos.tokenId}
                    className="bg-slate-800/50 rounded-lg p-4 border border-slate-700"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              pos.version === "V4"
                                ? "bg-purple-500/20 text-purple-400"
                                : "bg-pink-500/20 text-pink-400"
                            }`}
                          >
                            {pos.version || "V3"}
                          </span>
                          <span className="text-sm font-medium">
                            {pos.token0.symbol}/{pos.token1.symbol}
                          </span>
                        </div>
                        <a
                          href={`https://app.uniswap.org/pool/${pos.tokenId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-white text-xs font-mono"
                        >
                          #{pos.tokenId} ↗
                        </a>
                      </div>
                      <span className="text-xs text-slate-400">
                        Fee: {pos.fee / 10000}%
                      </span>
                    </div>

                    {/* Supplied */}
                    <div className="mb-3">
                      <div className="text-xs text-slate-500 uppercase mb-1">
                        Supplied
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="text-slate-400">Token</div>
                        <div className="text-slate-400 text-right">Amount</div>
                        <div className="text-slate-400 text-right">
                          USD Value
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm mt-1">
                        <div className="flex items-center gap-1">
                          <span className="text-emerald-400">●</span>
                          <span>{pos.token0.symbol}</span>
                        </div>
                        <div className="text-right font-mono">—</div>
                        <div className="text-right font-mono">—</div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm mt-1">
                        <div className="flex items-center gap-1">
                          <span className="text-blue-400">●</span>
                          <span>{pos.token1.symbol}</span>
                        </div>
                        <div className="text-right font-mono">—</div>
                        <div className="text-right font-mono">—</div>
                      </div>
                    </div>

                    {/* Rewards */}
                    <div className="mb-3">
                      <div className="text-xs text-slate-500 uppercase mb-1">
                        Claimable Rewards
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm">
                        <div className="flex items-center gap-1">
                          <span className="text-emerald-400">●</span>
                          <span>{pos.token0.symbol}</span>
                        </div>
                        <div className="text-right font-mono">
                          {parseFloat(pos.tokensOwed0).toFixed(4)}
                        </div>
                        <div className="text-right font-mono text-slate-400">
                          $
                          {(
                            parseFloat(pos.tokensOwed0) * pos.token0_price
                          ).toFixed(2)}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm mt-1">
                        <div className="flex items-center gap-1">
                          <span className="text-blue-400">●</span>
                          <span>{pos.token1.symbol}</span>
                        </div>
                        <div className="text-right font-mono">
                          {parseFloat(pos.tokensOwed1).toFixed(4)}
                        </div>
                        <div className="text-right font-mono text-slate-400">
                          $
                          {(
                            parseFloat(pos.tokensOwed1) * pos.token1_price
                          ).toFixed(2)}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <a
                        href={`https://app.uniswap.org/pool/${pos.tokenId}?chain=mainnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center px-3 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm"
                      >
                        Withdraw
                      </a>
                      <a
                        href={`https://app.uniswap.org/pool/${pos.tokenId}?chain=mainnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 text-center px-3 py-2 bg-pink-600 hover:bg-pink-500 rounded-lg text-sm"
                      >
                        Claim
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Transactions */}
        <div className="mt-6 bg-slate-900/50 rounded-xl border border-slate-700 p-4">
          <h3 className="font-semibold mb-4">Recent Transactions</h3>
          {loadingTxs ? (
            <div className="text-center text-slate-500 py-4">
              <div className="animate-pulse">Loading transactions...</div>
            </div>
          ) : txError ? (
            <div className="text-center py-4">
              <div className="text-red-400 mb-2">⚠️ {txError}</div>
              <button
                onClick={() => {
                  const addr = wallet.address || state.saved_wallet_address;
                  if (addr) fetchRecentTransactions(addr);
                }}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Retry
              </button>
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
