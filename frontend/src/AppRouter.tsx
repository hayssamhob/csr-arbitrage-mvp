/**
 * AppRouter - Handles routing between pages with unified navbar
 * Mode controls are now on each page's header (like ArbitragePage style)
 */

import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import App from "./App";
import { useWallet } from "./hooks/useWallet";
import { ArbitragePage } from "./pages/ArbitragePage";
import { InventoryPage } from "./pages/InventoryPage";
import { SettingsPage } from "./pages/SettingsPage";

function Navigation() {
  const wallet = useWallet();

  return (
    <nav className="bg-slate-900/95 border-b border-slate-700/50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-3">
          <img
            src="/depollute-logo-256.png"
            alt="Depollute Now!"
            className="h-9 w-9 rounded-lg"
          />
          <span className="hidden sm:block text-lg font-bold bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent">
            CSR Trading Hub
          </span>
        </div>

        {/* Center: Navigation Tabs */}
        <div className="flex items-center gap-1">
          <NavLink
            to="/alignment"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            <span className="hidden sm:inline">⚡ </span>Alignment
          </NavLink>
          <NavLink
            to="/arbitrage"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            <span className="hidden sm:inline">📈 </span>Arbitrage
          </NavLink>
          <NavLink
            to="/inventory"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            <span className="hidden sm:inline">💰 </span>Inventory
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            <span className="hidden sm:inline">⚙️ </span>Settings
          </NavLink>
        </div>

        {/* Right: Wallet Only (mode controls moved to page headers) */}
        <div className="flex items-center gap-2">
          {wallet.isConnected ? (
            <div className="flex items-center gap-1.5 bg-slate-800 rounded-lg px-2 py-1 border border-slate-700">
              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
              <span className="font-mono text-xs text-emerald-400">
                {wallet.address?.slice(0, 4)}...{wallet.address?.slice(-3)}
              </span>
              <button
                onClick={wallet.disconnect}
                className="text-xs text-slate-400 hover:text-red-400"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              onClick={wallet.connect}
              disabled={wallet.isConnecting}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-600 text-white rounded-lg font-medium text-xs transition-colors"
            >
              {wallet.isConnecting ? "..." : "🦊 Connect"}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function AppRouter() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900">
      <Navigation />
      <Routes>
        <Route path="/alignment" element={<App />} />
        <Route path="/arbitrage" element={<ArbitragePage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/" element={<Navigate to="/alignment" replace />} />
        <Route path="/defense" element={<Navigate to="/alignment" replace />} />
        <Route path="*" element={<Navigate to="/alignment" replace />} />
      </Routes>
    </div>
  );
}
