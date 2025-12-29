/**
 * AppRouter - Handles routing between pages with unified navbar
 */

import { useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import App from "./App";
import { ArbitragePage } from "./pages/ArbitragePage";
import { InventoryPage } from "./pages/InventoryPage";
import { SettingsPage } from "./pages/SettingsPage";

type ExecutionMode = "OFF" | "MANUAL" | "AUTO";

interface NavigationProps {
  executionMode: ExecutionMode;
  onModeChange: (mode: ExecutionMode) => void;
}

function Navigation({ executionMode, onModeChange }: NavigationProps) {
  return (
    <nav className="bg-slate-900/95 border-b border-slate-700/50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-16">
        {/* Left: Logo + Title */}
        <div className="flex items-center gap-3">
          <img
            src="/depollute-logo-256.png"
            alt="Depollute Now!"
            className="h-10 w-10 rounded-lg"
          />
          <span className="text-lg font-bold bg-gradient-to-r from-emerald-400 to-green-300 bg-clip-text text-transparent">
            CSR Trading Hub
          </span>
        </div>

        {/* Center: Navigation Tabs */}
        <div className="flex items-center gap-1">
          <NavLink
            to="/alignment"
            className={({ isActive }) =>
              `px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            ⚖️ Alignment
          </NavLink>
          <NavLink
            to="/arbitrage"
            className={({ isActive }) =>
              `px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            📈 Arbitrage
          </NavLink>
          <NavLink
            to="/inventory"
            className={({ isActive }) =>
              `px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            💰 Inventory
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`
            }
          >
            ⚙️ Settings
          </NavLink>
        </div>

        {/* Right: Execution Mode Controls */}
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-800 rounded-lg p-1">
            {(["OFF", "MANUAL", "AUTO"] as ExecutionMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => onModeChange(mode)}
                className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                  executionMode === mode
                    ? mode === "OFF"
                      ? "bg-slate-600 text-white"
                      : mode === "MANUAL"
                      ? "bg-amber-600 text-white"
                      : "bg-emerald-600 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}

export default function AppRouter() {
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("MANUAL");

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900">
      <Navigation
        executionMode={executionMode}
        onModeChange={setExecutionMode}
      />
      <Routes>
        <Route
          path="/alignment"
          element={<App executionMode={executionMode} />}
        />
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
