/**
 * Tooltip - Instant hover tooltip without browser delay
 */

import { useState, type ReactNode } from "react";

interface TooltipProps {
  content: string;
  children: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
}

export function Tooltip({ content, children, position = "top" }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  };

  return (
    <span
      className="relative inline-flex cursor-help"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <span
          className={`absolute z-50 px-2 py-1 text-xs text-white bg-slate-900 border border-slate-600 rounded shadow-lg whitespace-normal max-w-xs ${positionClasses[position]}`}
        >
          {content}
        </span>
      )}
    </span>
  );
}

// Simple info icon with tooltip
export function InfoTooltip({ content }: { content: string }) {
  return (
    <Tooltip content={content}>
      <span className="text-slate-500 hover:text-slate-300 ml-1">ⓘ</span>
    </Tooltip>
  );
}
