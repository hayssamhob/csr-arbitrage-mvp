/**
 * SettingsPage - User Configuration with Supabase Backend
 * Stores API keys (encrypted), wallets, and risk limits per user
 */

import { useEffect, useState } from "react";
import { Footer } from "../components/Footer";
import { useAuth } from "../contexts/AuthContext";

const API_URL =
  import.meta.env.VITE_API_URL || "https://trade.depollutenow.com";

interface RiskLimits {
  max_order_usdt: number;
  daily_limit_usdt: number;
  min_edge_bps: number;
  max_slippage_bps: number;
  kill_switch: boolean;
}

interface ExchangeStatus {
  venue: string;
  connected: boolean;
  api_key_masked: string | null;
  api_secret_masked: string | null;
  has_secret: boolean;
  last_test_ok: boolean | null;
  last_test_error: string | null;
  last_test_at: string | null;
}

interface Wallet {
  id: string;
  chain: string;
  address: string;
  label: string | null;
}

export function SettingsPage() {
  const { user, getAccessToken } = useAuth();

  // Risk Limits - NO DEFAULTS, must load from DB
  const [riskLimits, setRiskLimits] = useState<RiskLimits | null>(null);
  const [limitsLoading, setLimitsLoading] = useState(true);
  const [savingLimits, setSavingLimits] = useState(false);

  // Exchange Credentials
  const [exchanges, setExchanges] = useState<ExchangeStatus[]>([]);
  const [lbankKey, setLbankKey] = useState("");
  const [lbankSecret, setLbankSecret] = useState("");
  const [latokenKey, setLatokenKey] = useState("");
  const [latokenSecret, setLatokenSecret] = useState("");
  const [savingExchange, setSavingExchange] = useState<string | null>(null);
  const [testingExchange, setTestingExchange] = useState<string | null>(null);

  // Wallets
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [newWalletLabel, setNewWalletLabel] = useState("");
  const [savingWallet, setSavingWallet] = useState(false);

  // Messages
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Fetch data on mount
  useEffect(() => {
    if (user) {
      fetchRiskLimits();
      fetchExchanges();
      fetchWallets();
    }
  }, [user]);

  const authHeaders = async () => {
    const token = await getAccessToken();
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    };
  };

  const fetchRiskLimits = async () => {
    setLimitsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/me/risk-limits`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setRiskLimits(data);
      }
    } catch (err) {
      console.error("Failed to fetch risk limits:", err);
    } finally {
      setLimitsLoading(false);
    }
  };

  const fetchExchanges = async () => {
    try {
      const res = await fetch(`${API_URL}/api/me/exchanges`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setExchanges(data);
      }
    } catch (err) {
      console.error("Failed to fetch exchanges:", err);
    }
  };

  const fetchWallets = async () => {
    try {
      const res = await fetch(`${API_URL}/api/me/wallets`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        setWallets(data);
      }
    } catch (err) {
      console.error("Failed to fetch wallets:", err);
    }
  };

  const saveRiskLimits = async () => {
    setSavingLimits(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/me/risk-limits`, {
        method: "PUT",
        headers: await authHeaders(),
        body: JSON.stringify(riskLimits),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Risk limits saved!" });
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error" });
    }
    setSavingLimits(false);
  };

  const saveExchangeCredentials = async (venue: "lbank" | "latoken") => {
    setSavingExchange(venue);
    setMessage(null);
    const apiKey = venue === "lbank" ? lbankKey : latokenKey;
    const apiSecret = venue === "lbank" ? lbankSecret : latokenSecret;

    if (!apiKey) {
      setMessage({ type: "error", text: "API Key is required" });
      setSavingExchange(null);
      return;
    }

    // LATOKEN requires both key and secret
    if (venue === "latoken" && !apiSecret) {
      setMessage({ type: "error", text: "API Secret is required for LATOKEN" });
      setSavingExchange(null);
      return;
    }

    try {
      const res = await fetch(`${API_URL}/api/me/exchanges/${venue}`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ api_key: apiKey, api_secret: apiSecret }),
      });
      if (res.ok) {
        setMessage({
          type: "success",
          text: `${venue.toUpperCase()} credentials saved!`,
        });
        // Clear inputs after save
        if (venue === "lbank") {
          setLbankKey("");
          setLbankSecret("");
        } else {
          setLatokenKey("");
          setLatokenSecret("");
        }
        fetchExchanges();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error" });
    }
    setSavingExchange(null);
  };

  const testExchangeConnection = async (venue: string) => {
    setTestingExchange(venue);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/me/exchanges/${venue}/test`, {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({
          type: "success",
          text: `${venue.toUpperCase()} connection test passed!`,
        });
      } else {
        setMessage({
          type: "error",
          text: data.message || data.error || "Test failed",
        });
      }
      fetchExchanges();
    } catch (err) {
      setMessage({ type: "error", text: "Network error" });
    }
    setTestingExchange(null);
  };

  const addWallet = async () => {
    if (!newWalletAddress) return;
    setSavingWallet(true);
    setMessage(null);
    try {
      const res = await fetch(`${API_URL}/api/me/wallets`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          address: newWalletAddress,
          label: newWalletLabel || null,
          chain: "ethereum",
        }),
      });
      if (res.ok) {
        setMessage({ type: "success", text: "Wallet added!" });
        setNewWalletAddress("");
        setNewWalletLabel("");
        fetchWallets();
      } else {
        const err = await res.json();
        setMessage({
          type: "error",
          text: err.error || "Failed to add wallet",
        });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error" });
    }
    setSavingWallet(false);
  };

  const removeWallet = async (id: string) => {
    try {
      const res = await fetch(`${API_URL}/api/me/wallets/${id}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      if (res.ok) {
        fetchWallets();
      }
    } catch (err) {
      console.error("Failed to remove wallet:", err);
    }
  };

  const getExchangeStatus = (venue: string): ExchangeStatus | undefined => {
    return exchanges.find((e) => e.venue === venue);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-3">
        <div className="max-w-7xl mx-auto">
          <h1 className="text-xl font-bold">⚙️ Settings</h1>
          <p className="text-slate-400 text-sm">
            Signed in as <span className="text-emerald-400">{user?.email}</span>
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Message */}
        {message && (
          <div
            className={`p-4 rounded-xl text-sm ${
              message.type === "success"
                ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                : "bg-red-500/20 text-red-300 border border-red-500/30"
            }`}
          >
            {message.text}
          </div>
        )}

        {/* Exchange Credentials */}
        <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
          <h3 className="font-semibold mb-4">🔐 Exchange API Keys</h3>
          <p className="text-xs text-slate-500 mb-4">
            Keys are encrypted before storage. Only you can access them.
          </p>

          {/* LBank */}
          <div className="mb-6 p-4 bg-slate-800/50 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium">LBank</span>
              {getExchangeStatus("lbank") ? (
                <span className="text-emerald-400 text-sm">✓ Connected</span>
              ) : (
                <span className="text-slate-500 text-sm">Not configured</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mb-3">
              LBank requires both API key and secret for balance fetching
            </p>
            <div className="grid grid-cols-1 gap-3">
              <input
                type="text"
                placeholder="API Key"
                value={
                  lbankKey || getExchangeStatus("lbank")?.api_key_masked || ""
                }
                onChange={(e) => setLbankKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono"
              />
              <input
                type="text"
                placeholder="API Secret"
                value={
                  lbankSecret ||
                  getExchangeStatus("lbank")?.api_secret_masked ||
                  ""
                }
                onChange={(e) => setLbankSecret(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveExchangeCredentials("lbank")}
                  disabled={savingExchange === "lbank"}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded"
                >
                  {savingExchange === "lbank" ? "Saving..." : "Save LBank Key"}
                </button>
                {getExchangeStatus("lbank") && (
                  <button
                    onClick={() => testExchangeConnection("lbank")}
                    disabled={testingExchange === "lbank"}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded"
                  >
                    {testingExchange === "lbank" ? "Testing..." : "Test"}
                  </button>
                )}
              </div>
              {getExchangeStatus("lbank")?.last_test_error && (
                <p className="text-xs text-red-400">
                  Last error: {getExchangeStatus("lbank")?.last_test_error}
                </p>
              )}
            </div>
          </div>

          {/* LATOKEN */}
          <div className="p-4 bg-slate-800/50 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <span className="font-medium">LATOKEN</span>
              {getExchangeStatus("latoken") ? (
                <span className="text-emerald-400 text-sm">✓ Connected</span>
              ) : (
                <span className="text-slate-500 text-sm">Not configured</span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3">
              <input
                type="text"
                placeholder="API Key"
                value={
                  latokenKey ||
                  getExchangeStatus("latoken")?.api_key_masked ||
                  ""
                }
                onChange={(e) => setLatokenKey(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono"
              />
              <input
                type="text"
                placeholder="API Secret"
                value={
                  latokenSecret ||
                  getExchangeStatus("latoken")?.api_secret_masked ||
                  ""
                }
                onChange={(e) => setLatokenSecret(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveExchangeCredentials("latoken")}
                  disabled={savingExchange === "latoken"}
                  className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded"
                >
                  {savingExchange === "latoken"
                    ? "Saving..."
                    : "Save LATOKEN Keys"}
                </button>
                {getExchangeStatus("latoken") && (
                  <button
                    onClick={() => testExchangeConnection("latoken")}
                    disabled={testingExchange === "latoken"}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm rounded"
                  >
                    {testingExchange === "latoken" ? "Testing..." : "Test"}
                  </button>
                )}
              </div>
              {getExchangeStatus("latoken")?.last_test_error && (
                <p className="text-xs text-red-400">
                  Last error: {getExchangeStatus("latoken")?.last_test_error}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Wallets */}
        <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
          <h3 className="font-semibold mb-4">🔐 Wallet Addresses</h3>

          {/* Existing wallets */}
          {wallets.length > 0 && (
            <div className="space-y-2 mb-4">
              {wallets.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded"
                >
                  <div>
                    <div className="font-mono text-sm">
                      {w.address.slice(0, 6)}...{w.address.slice(-4)}
                    </div>
                    {w.label && (
                      <div className="text-xs text-slate-500">{w.label}</div>
                    )}
                  </div>
                  <button
                    onClick={() => removeWallet(w.id)}
                    className="text-red-400 hover:text-red-300 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new wallet */}
          <div className="grid grid-cols-1 gap-3">
            <input
              type="text"
              placeholder="Ethereum address (0x...)"
              value={newWalletAddress}
              onChange={(e) => setNewWalletAddress(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm font-mono"
            />
            <input
              type="text"
              placeholder="Label (optional)"
              value={newWalletLabel}
              onChange={(e) => setNewWalletLabel(e.target.value)}
              className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm"
            />
            <button
              onClick={addWallet}
              disabled={savingWallet || !newWalletAddress}
              className="py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm rounded"
            >
              {savingWallet ? "Adding..." : "Add Wallet"}
            </button>
          </div>
        </div>

        {/* Risk Limits */}
        <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
          <h3 className="font-semibold mb-4">⚠️ Risk Limits</h3>
          {limitsLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              <p className="text-sm text-slate-400">Loading settings...</p>
            </div>
          ) : !riskLimits ? (
            <div className="text-center py-8 text-red-400">
              <p>Failed to load settings. Please refresh.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Max Order (USDT)
                  </label>
                  <input
                    type="number"
                    value={riskLimits.max_order_usdt}
                    onChange={(e) =>
                      setRiskLimits((s) =>
                        s
                          ? {
                              ...s,
                              max_order_usdt: +e.target.value,
                            }
                          : s
                      )
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Daily Limit (USDT)
                  </label>
                  <input
                    type="number"
                    value={riskLimits.daily_limit_usdt}
                    onChange={(e) =>
                      setRiskLimits((s) =>
                        s
                          ? {
                              ...s,
                              daily_limit_usdt: +e.target.value,
                            }
                          : s
                      )
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Min Edge (bps)
                  </label>
                  <input
                    type="number"
                    value={riskLimits.min_edge_bps}
                    onChange={(e) =>
                      setRiskLimits((s) =>
                        s
                          ? {
                              ...s,
                              min_edge_bps: +e.target.value,
                            }
                          : s
                      )
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm text-slate-400 mb-1">
                    Max Slippage (bps)
                  </label>
                  <input
                    type="number"
                    value={riskLimits.max_slippage_bps}
                    onChange={(e) =>
                      setRiskLimits((s) =>
                        s
                          ? {
                              ...s,
                              max_slippage_bps: +e.target.value,
                            }
                          : s
                      )
                    }
                    className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2"
                  />
                </div>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={riskLimits.kill_switch}
                    onChange={(e) =>
                      setRiskLimits((s) =>
                        s
                          ? {
                              ...s,
                              kill_switch: e.target.checked,
                            }
                          : s
                      )
                    }
                    className="w-4 h-4 rounded"
                  />
                  <span className="text-sm">
                    Kill Switch (halt all trading)
                  </span>
                </label>
              </div>

              <button
                onClick={saveRiskLimits}
                disabled={savingLimits}
                className="mt-4 w-full py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50"
              >
                {savingLimits ? "Saving..." : "Save Risk Limits"}
              </button>
            </>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
