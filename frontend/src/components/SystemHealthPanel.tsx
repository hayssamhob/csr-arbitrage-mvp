/**
 * SystemHealthPanel - Real-time service health monitoring
 * Shows TRUE health status for all services with auto-refresh
 */

import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "https://trade.depollutenow.com";

interface ServiceHealth {
  name: string;
  status: "ok" | "degraded" | "down" | "unknown";
  lastCheck: string;
  lastSuccess: string | null;
  lastError: string | null;
  details: {
    connected?: boolean;
    is_stale?: boolean;
    reconnect_count?: number;
    last_message_ts?: string;
    errors_last_5m?: number;
  };
}

interface SystemStatus {
  status: "ok" | "degraded" | "down";
  ts: string;
  services: ServiceHealth[];
  external: Record<string, ServiceHealth>;
}

function getStatusColor(status: string): string {
  switch (status) {
    case "ok":
      return "bg-emerald-500";
    case "degraded":
      return "bg-yellow-500";
    case "down":
      return "bg-red-500";
    default:
      return "bg-slate-500";
  }
}

function getStatusBorderColor(status: string): string {
  switch (status) {
    case "ok":
      return "border-emerald-500/30";
    case "degraded":
      return "border-yellow-500/30";
    case "down":
      return "border-red-500/30";
    default:
      return "border-slate-500/30";
  }
}

function formatAge(timestamp: string | number | null): string {
  if (!timestamp) return "Never";
  const now = Date.now();
  const then = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  const age = now - then;

  if (age < 0) return "Just now"; // Handle clock drift
  if (age < 1000) return "Just now";
  if (age < 60000) return `${Math.floor(age / 1000)}s ago`;
  if (age < 3600000) return `${Math.floor(age / 60000)}m ago`;
  return `${Math.floor(age / 3600000)}h ago`;
}

function ServiceCard({ service }: { service: ServiceHealth }) {
  const statusColor = getStatusColor(service.status);
  const borderColor = getStatusBorderColor(service.status);

  return (
    <div className={`bg-slate-800/50 rounded-lg p-3 border ${borderColor}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${statusColor}`} />
          <span className="font-medium text-sm">{service.name}</span>
        </div>
        <span
          className={`text-xs px-2 py-0.5 rounded ${service.status === "ok"
              ? "bg-emerald-500/20 text-emerald-400"
              : service.status === "degraded"
                ? "bg-yellow-500/20 text-yellow-400"
                : "bg-red-500/20 text-red-400"
            }`}
        >
          {service.status.toUpperCase()}
        </span>
      </div>

      <div className="text-xs text-slate-400 space-y-1">
        <div className="flex justify-between">
          <span>Last success:</span>
          <span className="text-slate-300">{formatAge(service.lastSuccess)}</span>
        </div>
        {service.details.reconnect_count !== undefined && (
          <div className="flex justify-between">
            <span>Reconnects:</span>
            <span className="text-slate-300">{service.details.reconnect_count}</span>
          </div>
        )}
        {service.details.errors_last_5m !== undefined && service.details.errors_last_5m > 0 && (
          <div className="flex justify-between">
            <span>Errors (5m):</span>
            <span className="text-red-400">{service.details.errors_last_5m}</span>
          </div>
        )}
        {service.lastError && (
          <div className="mt-1 text-red-400 truncate" title={service.lastError}>
            ⚠️ {service.lastError}
          </div>
        )}
      </div>
    </div>
  );
}

export function SystemHealthPanel() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const fetchStatus = async () => {
    try {
      const response = await fetch(`${API_URL}/api/system/status`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Refresh every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading && !status) {
    return (
      <div className="bg-slate-900/50 rounded-xl border border-slate-700 p-4">
        <div className="animate-pulse text-slate-400">Loading system status...</div>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="bg-slate-900/50 rounded-xl border border-red-500/30 p-4">
        <div className="text-red-400">⚠️ Failed to load system status: {error}</div>
      </div>
    );
  }

  if (!status) return null;

  const overallColor = getStatusColor(status.status);
  const healthyCount = status.services.filter((s) => s.status === "ok").length;
  const totalCount = status.services.length;

  return (
    <div className="bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`w-3 h-3 rounded-full ${overallColor}`} />
          <span className="font-medium">System Health</span>
          <span className="text-sm text-slate-400">
            {healthyCount}/{totalCount} services healthy
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            Updated {formatAge(status.ts)}
          </span>
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""
              }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-700/50">
          <div className="mt-3 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {status.services.map((service) => (
              <ServiceCard key={service.name} service={service} />
            ))}
            {/* External dependencies */}
            {Object.values(status.external).map((service) => (
              <ServiceCard key={service.name} service={service} />
            ))}
          </div>

          {/* Quick actions */}
          <div className="mt-4 flex items-center gap-2 text-xs">
            <button
              onClick={fetchStatus}
              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
            >
              Refresh Now
            </button>
            {status.status !== "ok" && (
              <span className="text-yellow-400">
                ⚠️ Some services need attention
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
