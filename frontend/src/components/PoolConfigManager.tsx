/**
 * PoolConfigManager - Manage DEX Pool Configurations
 * Allows users to view global pools and add custom pools for new pairs/networks
 */

import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const API_URL =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD ? "" : "http://localhost:8001");

interface PoolConfig {
  id: string;
  chain_id: number;
  dex_protocol: string;
  pool_id: string;
  base_symbol: string;
  quote_symbol: string;
  base_token_address: string;
  quote_token_address: string;
  base_decimals: number;
  quote_decimals: number;
  fee_bps: number | null;
  tick_spacing: number | null;
  hook_address: string | null;
  is_active: boolean;
  is_global: boolean;
  created_at: string;
}

const CHAIN_NAMES: Record<number, string> = {
  1: "Ethereum",
  10: "Optimism",
  137: "Polygon",
  42161: "Arbitrum",
  8453: "Base",
};

export function PoolConfigManager() {
  const { getAccessToken } = useAuth();
  const [pools, setPools] = useState<PoolConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Form state for adding new pool
  const [newPool, setNewPool] = useState({
    chain_id: 1,
    dex_protocol: "uniswap_v4",
    pool_id: "",
    base_symbol: "",
    quote_symbol: "USDT",
    base_token_address: "",
    quote_token_address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    base_decimals: 18,
    quote_decimals: 6,
    fee_bps: "",
    tick_spacing: "",
    hook_address: "",
  });

  const authHeaders = async () => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  };

  const fetchPools = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/me/pool-configs`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setPools(data.pools || []);
      }
    } catch (err) {
      console.error("Failed to fetch pool configs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPools();
  }, []);

  const handleAddPool = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(`${API_URL}/api/me/pool-configs`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          ...newPool,
          fee_bps: newPool.fee_bps ? parseInt(newPool.fee_bps) : null,
          tick_spacing: newPool.tick_spacing ? parseInt(newPool.tick_spacing) : null,
          hook_address: newPool.hook_address || null,
        }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Pool added successfully" });
        setShowAddForm(false);
        setNewPool({
          chain_id: 1,
          dex_protocol: "uniswap_v4",
          pool_id: "",
          base_symbol: "",
          quote_symbol: "USDT",
          base_token_address: "",
          quote_token_address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
          base_decimals: 18,
          quote_decimals: 6,
          fee_bps: "",
          tick_spacing: "",
          hook_address: "",
        });
        fetchPools();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to add pool" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePool = async (poolId: string) => {
    if (!confirm("Are you sure you want to delete this pool?")) return;

    try {
      const res = await fetch(`${API_URL}/api/me/pool-configs/${poolId}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Pool deleted" });
        fetchPools();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to delete pool" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message });
    }
  };

  const handleToggleActive = async (pool: PoolConfig) => {
    try {
      const res = await fetch(`${API_URL}/api/me/pool-configs/${pool.id}`, {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify({ is_active: !pool.is_active }),
      });

      if (res.ok) {
        fetchPools();
      }
    } catch (err) {
      console.error("Failed to toggle pool:", err);
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-semibold text-white">DEX Pool Configuration</h2>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm"
        >
          {showAddForm ? "Cancel" : "+ Add Pool"}
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 p-3 rounded ${
            message.type === "success" ? "bg-green-900/50 text-green-300" : "bg-red-900/50 text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {showAddForm && (
        <form onSubmit={handleAddPool} className="mb-6 p-4 bg-gray-700 rounded-lg">
          <h3 className="text-lg font-medium text-white mb-4">Add New Pool</h3>
          
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Chain</label>
              <select
                value={newPool.chain_id}
                onChange={(e) => setNewPool({ ...newPool, chain_id: parseInt(e.target.value) })}
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
              >
                <option value={1}>Ethereum</option>
                <option value={10}>Optimism</option>
                <option value={137}>Polygon</option>
                <option value={42161}>Arbitrum</option>
                <option value={8453}>Base</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Protocol</label>
              <select
                value={newPool.dex_protocol}
                onChange={(e) => setNewPool({ ...newPool, dex_protocol: e.target.value })}
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
              >
                <option value="uniswap_v4">Uniswap V4</option>
                <option value="uniswap_v3">Uniswap V3</option>
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-400 mb-1">Pool ID (bytes32)</label>
              <input
                type="text"
                value={newPool.pool_id}
                onChange={(e) => setNewPool({ ...newPool, pool_id: e.target.value })}
                placeholder="0x..."
                className="w-full bg-gray-600 text-white rounded px-3 py-2 font-mono text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Base Symbol</label>
              <input
                type="text"
                value={newPool.base_symbol}
                onChange={(e) => setNewPool({ ...newPool, base_symbol: e.target.value.toUpperCase() })}
                placeholder="e.g., CSR"
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Quote Symbol</label>
              <input
                type="text"
                value={newPool.quote_symbol}
                onChange={(e) => setNewPool({ ...newPool, quote_symbol: e.target.value.toUpperCase() })}
                placeholder="e.g., USDT"
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
                required
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-400 mb-1">Base Token Address</label>
              <input
                type="text"
                value={newPool.base_token_address}
                onChange={(e) => setNewPool({ ...newPool, base_token_address: e.target.value })}
                placeholder="0x..."
                className="w-full bg-gray-600 text-white rounded px-3 py-2 font-mono text-sm"
                required
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm text-gray-400 mb-1">Quote Token Address</label>
              <input
                type="text"
                value={newPool.quote_token_address}
                onChange={(e) => setNewPool({ ...newPool, quote_token_address: e.target.value })}
                placeholder="0x..."
                className="w-full bg-gray-600 text-white rounded px-3 py-2 font-mono text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Base Decimals</label>
              <input
                type="number"
                value={newPool.base_decimals}
                onChange={(e) => setNewPool({ ...newPool, base_decimals: parseInt(e.target.value) })}
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Quote Decimals</label>
              <input
                type="number"
                value={newPool.quote_decimals}
                onChange={(e) => setNewPool({ ...newPool, quote_decimals: parseInt(e.target.value) })}
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Fee (bps, optional)</label>
              <input
                type="number"
                value={newPool.fee_bps}
                onChange={(e) => setNewPool({ ...newPool, fee_bps: e.target.value })}
                placeholder="e.g., 3000"
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-400 mb-1">Tick Spacing (optional)</label>
              <input
                type="number"
                value={newPool.tick_spacing}
                onChange={(e) => setNewPool({ ...newPool, tick_spacing: e.target.value })}
                placeholder="e.g., 60"
                className="w-full bg-gray-600 text-white rounded px-3 py-2"
              />
            </div>
          </div>

          <div className="mt-4">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg"
            >
              {saving ? "Saving..." : "Add Pool"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="text-gray-400">Loading pools...</div>
      ) : pools.length === 0 ? (
        <div className="text-gray-400">No pools configured</div>
      ) : (
        <div className="space-y-3">
          {pools.map((pool) => (
            <div
              key={pool.id}
              className={`p-4 rounded-lg border ${
                pool.is_global
                  ? "bg-blue-900/20 border-blue-700"
                  : pool.is_active
                  ? "bg-gray-700 border-gray-600"
                  : "bg-gray-800 border-gray-700 opacity-60"
              }`}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold text-white">
                      {pool.base_symbol}/{pool.quote_symbol}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-gray-600 text-gray-300">
                      {CHAIN_NAMES[pool.chain_id] || `Chain ${pool.chain_id}`}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-purple-900 text-purple-300">
                      {pool.dex_protocol}
                    </span>
                    {pool.is_global && (
                      <span className="text-xs px-2 py-0.5 rounded bg-blue-900 text-blue-300">
                        Global
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-gray-400 font-mono truncate max-w-md">
                    Pool: {pool.pool_id.slice(0, 20)}...{pool.pool_id.slice(-8)}
                  </div>
                  {pool.fee_bps && (
                    <div className="text-xs text-gray-500">Fee: {pool.fee_bps / 100}%</div>
                  )}
                </div>

                {!pool.is_global && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleToggleActive(pool)}
                      className={`px-3 py-1 rounded text-sm ${
                        pool.is_active
                          ? "bg-yellow-600 hover:bg-yellow-700 text-white"
                          : "bg-green-600 hover:bg-green-700 text-white"
                      }`}
                    >
                      {pool.is_active ? "Disable" : "Enable"}
                    </button>
                    <button
                      onClick={() => handleDeletePool(pool.id)}
                      className="px-3 py-1 rounded text-sm bg-red-600 hover:bg-red-700 text-white"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 p-3 bg-gray-700/50 rounded text-sm text-gray-400">
        <strong>Note:</strong> Global pools (marked in blue) are system defaults and cannot be modified.
        You can add custom pools for additional token pairs or networks.
      </div>
    </div>
  );
}
