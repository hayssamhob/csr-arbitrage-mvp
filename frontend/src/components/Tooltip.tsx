/**
 * Tooltip - INSTANT hover tooltip (no delay)
 * Supports both string and ReactNode content for rich tooltips
 */

import { useState, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  maxWidth?: string;
}

export function Tooltip({
  content,
  children,
  position = "bottom",
  maxWidth = "320px",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div
          className={`absolute z-[9999] px-3 py-2 text-xs text-white bg-slate-900 border border-slate-600 rounded-lg shadow-2xl ${positionClasses[position]}`}
          style={{ maxWidth, minWidth: "200px" }}
        >
          {content}
        </div>
      )}
    </span>
  );
}

// Simple info icon with tooltip
export function InfoTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="text-slate-500 hover:text-slate-300 ml-1 cursor-help">
        ⓘ
      </span>
    </Tooltip>
  );
}

// Rich service status tooltip content
interface ServiceTooltipProps {
  name: string;
  status: "ok" | "warning" | "error" | "offline";
  lastUpdate?: string;
  ageSeconds?: number;
  isStale?: boolean;
  reason?: string;
  details?: {
    connected?: boolean;
    reconnectCount?: number;
    errorsLast5m?: number;
    lastMessageTs?: string;
    subscriptionErrors?: Record<string, string>;
  };
}

export function ServiceTooltipContent({ name, status, lastUpdate, ageSeconds, isStale, reason, details }: ServiceTooltipProps) {
  const getStatusLabel = () => {
    if (status === "ok" && !isStale) return { text: "HEALTHY", color: "text-emerald-400" };
    if (status === "error") return { text: "ERROR", color: "text-red-400" };
    if (status === "offline") return { text: "OFFLINE", color: "text-slate-400" };
    if (isStale) return { text: "STALE DATA", color: "text-amber-400" };
    return { text: "WARNING", color: "text-amber-400" };
  };

  const statusLabel = getStatusLabel();
  
  const formatTimestamp = (ts?: string) => {
    if (!ts) return "Never";
    const date = new Date(ts);
    const now = Date.now();
    const ageSec = Math.floor((now - date.getTime()) / 1000);
    if (ageSec < 5) return "Just now";
    if (ageSec < 60) return `${ageSec}s ago`;
    if (ageSec < 3600) return `${Math.floor(ageSec / 60)}m ago`;
    return date.toLocaleTimeString();
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-700 pb-2">
        <span className="font-bold text-sm text-white">{name}</span>
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${statusLabel.color} bg-slate-800`}>
          {statusLabel.text}
        </span>
      </div>

      {/* Status Details */}
      <div className="space-y-1.5 text-[11px]">
        {/* Data Age */}
        <div className="flex justify-between">
          <span className="text-slate-400">Data Age:</span>
          <span className={`font-mono ${isStale ? "text-amber-400" : "text-slate-200"}`}>
            {ageSeconds !== undefined ? `${ageSeconds}s` : "—"}
            {isStale && " ⚠️ STALE"}
          </span>
        </div>

        {/* Last Update */}
        <div className="flex justify-between">
          <span className="text-slate-400">Last Update:</span>
          <span className="text-slate-200 font-mono">{formatTimestamp(lastUpdate)}</span>
        </div>

        {/* Connection Status */}
        {details?.connected !== undefined && (
          <div className="flex justify-between">
            <span className="text-slate-400">WebSocket:</span>
            <span className={details.connected ? "text-emerald-400" : "text-red-400"}>
              {details.connected ? "✓ Connected" : "✗ Disconnected"}
            </span>
          </div>
        )}

        {/* Last Message */}
        {details?.lastMessageTs && (
          <div className="flex justify-between">
            <span className="text-slate-400">Last Message:</span>
            <span className="text-slate-200 font-mono">{formatTimestamp(details.lastMessageTs)}</span>
          </div>
        )}

        {/* Reconnect Count */}
        {details?.reconnectCount !== undefined && details.reconnectCount > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-400">Reconnections:</span>
            <span className="text-amber-400 font-mono">{details.reconnectCount}</span>
          </div>
        )}

        {/* Errors */}
        {details?.errorsLast5m !== undefined && details.errorsLast5m > 0 && (
          <div className="flex justify-between">
            <span className="text-slate-400">Errors (5m):</span>
            <span className="text-red-400 font-mono">{details.errorsLast5m}</span>
          </div>
        )}

        {/* Reason */}
        {reason && (
          <div className="pt-1 border-t border-slate-700">
            <span className="text-slate-400">Reason: </span>
            <span className="text-red-300">{reason}</span>
          </div>
        )}

        {/* Subscription Errors */}
        {details?.subscriptionErrors && Object.keys(details.subscriptionErrors).length > 0 && (
          <div className="pt-1 border-t border-slate-700">
            <span className="text-slate-400 block mb-1">Subscription Issues:</span>
            {Object.entries(details.subscriptionErrors).map(([pair, error]) => (
              <div key={pair} className="text-red-300 text-[10px] pl-2">
                • {pair}: {error}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-700 italic">
        {status === "ok" && !isStale 
          ? "Service operating normally" 
          : "Check service logs for details"}
      </div>
    </div>
  );
}
