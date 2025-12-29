/**
 * GlobalStatusBar - Always Visible at Top
 * 
 * Shows:
 * - Per-service health with explicit reason strings
 * - Data freshness timestamps (CEX <30s, DEX <60s)
 * - Execution mode + kill switch
 */

export interface ServiceStatus {
  name: string;
  status: "ok" | "warning" | "error" | "offline";
  lastUpdate: string;
  reason?: string; // Explicit reason when not OK
  ageSeconds?: number; // Data age in seconds
  isStale?: boolean; // True if data exceeds freshness threshold
}

interface GlobalStatusBarProps {
  services: ServiceStatus[];
  lastDataUpdate: Date;
}

// Note: Freshness thresholds (CEX: 30s, DEX: 60s) are applied in App.tsx

export function GlobalStatusBar({ services, lastDataUpdate }: GlobalStatusBarProps) {
  const allHealthy = services.every((s) => s.status === "ok" && !s.isStale);
  const hasErrors = services.some(
    (s) => s.status === "error" || s.status === "offline"
  );
  const staleServices = services.filter((s) => s.isStale);

  const getStatusColor = (
    status: ServiceStatus["status"],
    isStale?: boolean
  ) => {
    if (isStale) return "bg-yellow-500";
    switch (status) {
      case "ok":
        return "bg-emerald-500";
      case "warning":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      case "offline":
        return "bg-slate-500";
    }
  };

  const timeSinceUpdate = () => {
    const seconds = Math.floor((Date.now() - lastDataUpdate.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  };

  // Build status summary with explicit reasons
  const getStatusSummary = () => {
    if (allHealthy) return "All Data Fresh";

    const issues: string[] = [];
    services.forEach((s) => {
      if (s.status === "error" || s.status === "offline") {
        issues.push(`${s.name}: ${s.reason || "offline"}`);
      } else if (s.isStale) {
        issues.push(`${s.name}: stale (${s.ageSeconds}s)`);
      }
    });

    if (issues.length === 0 && staleServices.length > 0) {
      return `Stale: ${staleServices.map((s) => s.name).join(", ")}`;
    }

    return issues.length > 0 ? issues[0] : "Checking...";
  };

  return (
    <div className="bg-slate-900/80 backdrop-blur-sm border-b border-slate-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 py-2">
        <div className="flex items-center justify-between flex-wrap gap-3">
          {/* System Health with explicit reason */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  allHealthy
                    ? "bg-emerald-500 animate-pulse"
                    : hasErrors
                    ? "bg-red-500 animate-pulse"
                    : "bg-yellow-500"
                }`}
              />
              <span
                className={`text-sm ${
                  allHealthy
                    ? "text-slate-300"
                    : hasErrors
                    ? "text-red-400"
                    : "text-yellow-400"
                }`}
              >
                {getStatusSummary()}
              </span>
            </div>

            {/* Service indicators with freshness */}
            <div className="hidden sm:flex items-center gap-1">
              {services.map((service) => (
                <div
                  key={service.name}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded ${
                    service.isStale ? "bg-yellow-900/30" : "bg-slate-800/50"
                  }`}
                  title={`${service.name}: ${service.status}${
                    service.isStale ? " (STALE)" : ""
                  }${service.reason ? ` - ${service.reason}` : ""} | Age: ${
                    service.ageSeconds || "?"
                  }s`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${getStatusColor(
                      service.status,
                      service.isStale
                    )}`}
                  />
                  <span
                    className={`text-xs ${
                      service.isStale ? "text-yellow-500" : "text-slate-500"
                    }`}
                  >
                    {service.name}
                    {service.ageSeconds !== undefined && (
                      <span className="ml-1 opacity-60">
                        {service.ageSeconds}s
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Data Freshness */}
          <div
            className="flex items-center gap-2 text-xs"
            title="Time since last data refresh from all sources. Data older than 30s (CEX) or 60s (DEX) is considered stale."
          >
            <span className="text-slate-500">Last update:</span>
            <span className="font-mono text-slate-300">
              {timeSinceUpdate()}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
