/**
 * GlobalStatusBar - Always Visible at Top
 * 
 * Shows:
 * - Overall system health
 * - Data freshness timestamps
 * - Execution mode + kill switch
 */

interface ServiceStatus {
  name: string;
  status: "ok" | "warning" | "error" | "offline";
  lastUpdate: string;
}

interface GlobalStatusBarProps {
  services: ServiceStatus[];
  executionMode: "OFF" | "MANUAL" | "AUTO";
  onModeChange: (mode: "OFF" | "MANUAL" | "AUTO") => void;
  killSwitchActive: boolean;
  onKillSwitchToggle: () => void;
  lastDataUpdate: Date;
}

export function GlobalStatusBar({
  services,
  executionMode,
  onModeChange,
  killSwitchActive,
  onKillSwitchToggle,
  lastDataUpdate,
}: GlobalStatusBarProps) {
  const allHealthy = services.every(s => s.status === "ok");
  const hasErrors = services.some(s => s.status === "error" || s.status === "offline");

  const getStatusColor = (status: ServiceStatus["status"]) => {
    switch (status) {
      case "ok": return "bg-emerald-500";
      case "warning": return "bg-yellow-500";
      case "error": return "bg-red-500";
      case "offline": return "bg-slate-500";
    }
  };

  const timeSinceUpdate = () => {
    const seconds = Math.floor((Date.now() - lastDataUpdate.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* System Health */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${
                allHealthy ? "bg-emerald-500 animate-pulse" : 
                hasErrors ? "bg-red-500 animate-pulse" : 
                "bg-yellow-500"
              }`} />
              <span className="text-sm text-slate-300">
                {allHealthy ? "All Systems Operational" : 
                 hasErrors ? "System Issues Detected" : 
                 "Partial Degradation"}
              </span>
            </div>
            
            {/* Service indicators */}
            <div className="hidden sm:flex items-center gap-1">
              {services.map((service) => (
                <div
                  key={service.name}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800/50"
                  title={`${service.name}: ${service.status} (${service.lastUpdate})`}
                >
                  <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(service.status)}`} />
                  <span className="text-xs text-slate-500">{service.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Data Freshness */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Last update:</span>
            <span className="font-mono text-slate-300">{timeSinceUpdate()}</span>
          </div>

          {/* Execution Controls */}
          <div className="flex items-center gap-3">
            {/* Mode Selector */}
            <div className="flex items-center gap-1 bg-slate-800 rounded-lg p-0.5">
              {(["OFF", "MANUAL"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onModeChange(mode)}
                  disabled={killSwitchActive && mode !== "OFF"}
                  className={`px-3 py-1 text-xs font-medium rounded transition-all ${
                    executionMode === mode
                      ? mode === "OFF" 
                        ? "bg-slate-600 text-white"
                        : "bg-blue-600 text-white"
                      : "text-slate-400 hover:text-white hover:bg-slate-700"
                  } ${killSwitchActive && mode !== "OFF" ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {mode}
                </button>
              ))}
            </div>

            {/* Kill Switch */}
            <button
              onClick={onKillSwitchToggle}
              className={`px-3 py-1 text-xs font-bold rounded-lg transition-all ${
                killSwitchActive
                  ? "bg-red-600 text-white animate-pulse"
                  : "bg-emerald-600/80 text-white hover:bg-emerald-600"
              }`}
            >
              {killSwitchActive ? "🛑 KILL ACTIVE" : "🛡️ SAFE"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
