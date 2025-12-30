/**
 * AppRouter - Handles routing between pages with unified navbar
 * Mode controls are now on each page's header (like ArbitragePage style)
 */

import { useState } from "react";
import { Link, Navigate, NavLink, Route, Routes } from "react-router-dom";
import App from "./App";
import { ActivityNotificationPanel } from "./components/ActivityNotificationPanel";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { useWallet } from "./hooks/useWallet";
import { ArbitragePage } from "./pages/ArbitragePage";
import { InventoryPage } from "./pages/InventoryPage";
import { LoginPage } from "./pages/LoginPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { SettingsPage } from "./pages/SettingsPage";

function Navigation() {
  const wallet = useWallet();
  const { user, signOut } = useAuth();
  const [showActivityPanel, setShowActivityPanel] = useState(false);

  return (
    <nav className="bg-slate-950/60 backdrop-blur-xl border-b border-slate-800/50 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-24 gap-4">
        {/* Left: Logo + Title - Clickable to go home */}
        <Link
          to="/alignment"
          className="flex items-center gap-5 cursor-pointer flex-shrink-0"
        >
          <div className="relative group">
            <div className="absolute -inset-1.5 bg-gradient-to-r from-emerald-500 via-cyan-500 to-blue-600 rounded-2xl blur-md opacity-20 group-hover:opacity-40 transition duration-500"></div>
            <img
              src="/depollute-logo-256.png"
              alt="Depollute Now!"
              className="relative h-18 w-18 rounded-2xl shadow-2xl transition-all duration-300 group-hover:scale-105 group-hover:rotate-1"
            />
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-tighter leading-none">
              <span className="bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                CSR
              </span>
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent ml-1">
                HUB
              </span>
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-[10px] uppercase tracking-[0.3em] text-emerald-500/80 font-black">
                Arbitrage Live
              </span>
            </div>
          </div>
        </Link>

        {/* Center: Navigation Tabs */}
        <div className="hidden lg:flex items-center gap-1.5 bg-slate-900/50 p-1.5 rounded-2xl border border-slate-800/50 shadow-inner">
          <NavLink
            to="/alignment"
            className={({ isActive }) =>
              `px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2.5 ${
                isActive
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 scale-[1.02]"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/80"
              }`
            }
          >
            <span className="text-lg">⚡</span>
            <span>Alignment</span>
          </NavLink>
          <NavLink
            to="/arbitrage"
            className={({ isActive }) =>
              `px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2.5 ${
                isActive
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 scale-[1.02]"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/80"
              }`
            }
          >
            <span className="text-lg">📈</span>
            <span>Arbitrage</span>
          </NavLink>
          <NavLink
            to="/inventory"
            className={({ isActive }) =>
              `px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2.5 ${
                isActive
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 scale-[1.02]"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/80"
              }`
            }
          >
            <span className="text-lg">💼</span>
            <span>Inventory</span>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 flex items-center gap-2.5 ${
                isActive
                  ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 scale-[1.02]"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/80"
              }`
            }
          >
            <span className="text-lg">⚙️</span>
            <span>Settings</span>
          </NavLink>
        </div>

        {/* Right: Bell + Auth + Wallet */}
        <div className="flex items-center gap-4">
          {/* Activity/Notification Bell */}
          <button
            onClick={() => setShowActivityPanel(!showActivityPanel)}
            className="relative p-2.5 rounded-xl border border-slate-700/50 hover:border-emerald-500/50 hover:bg-slate-800/50 transition-all duration-300 group"
          >
            <span className="text-lg group-hover:scale-110 transition-transform inline-block">
              🔔
            </span>
            {/* Notification dot */}
            <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          </button>

          {user ? (
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-[9px] text-slate-500 font-black uppercase tracking-widest">
                  Terminal ID
                </span>
                <span className="text-xs text-slate-300 font-bold font-mono">
                  {user.email?.split("@")[0]}
                </span>
              </div>
              <button
                onClick={() => signOut()}
                className="group relative px-4 py-2 overflow-hidden rounded-xl border border-slate-700/50 transition-all duration-300 hover:border-red-500/50"
              >
                <div className="absolute inset-0 bg-red-500/0 group-hover:bg-red-500/5 transition-colors duration-300"></div>
                <span className="relative text-xs font-bold text-slate-400 group-hover:text-red-400">
                  Logout
                </span>
              </button>
            </div>
          ) : (
            <NavLink
              to="/login"
              className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 rounded-xl shadow-lg shadow-emerald-900/30 transition-all duration-300 active:scale-95"
            >
              <span className="text-sm font-bold text-white">Sign In</span>
            </NavLink>
          )}

          <div className="h-10 w-px bg-slate-800 mx-1 hidden sm:block"></div>

          {wallet.isConnected ? (
            <div className="flex items-center gap-3 px-4 py-2 bg-emerald-500/5 rounded-xl border border-emerald-500/20 group hover:border-emerald-500/40 transition-colors">
              <div className="relative">
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-ping absolute opacity-75"></div>
                <div className="h-2 w-2 rounded-full bg-emerald-500 relative"></div>
              </div>
              <span className="text-xs font-black font-mono text-emerald-400 tracking-wider group-hover:text-emerald-300">
                {wallet.address?.slice(0, 6)}
              </span>
            </div>
          ) : (
            <button
              onClick={() => wallet.connect()}
              disabled={wallet.isConnecting}
              className="relative group px-5 py-2.5 overflow-hidden rounded-xl bg-slate-900 border border-slate-700 transition-all duration-300 active:scale-95 hover:border-emerald-500/50"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-600/0 to-emerald-600/10 group-hover:from-emerald-600/10 transition-all"></div>
              <span className="relative text-xs font-black text-slate-300 group-hover:text-white">
                {wallet.isConnecting ? "CONNECTING..." : "CONNECT WALLET"}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Activity/Notification Panel */}
      <ActivityNotificationPanel
        isOpen={showActivityPanel}
        onClose={() => setShowActivityPanel(false)}
      />
    </nav>
  );
}

function AppContent() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900">
      <Navigation />
      <Routes>
        {/* Public routes */}
        <Route path="/alignment" element={<App />} />
        <Route path="/arbitrage" element={<ArbitragePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

        {/* Protected routes - require authentication */}
        <Route
          path="/inventory"
          element={
            <ProtectedRoute>
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />

        {/* Redirects */}
        <Route path="/" element={<Navigate to="/alignment" replace />} />
        <Route path="/defense" element={<Navigate to="/alignment" replace />} />
        <Route path="*" element={<Navigate to="/alignment" replace />} />
      </Routes>
    </div>
  );
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
