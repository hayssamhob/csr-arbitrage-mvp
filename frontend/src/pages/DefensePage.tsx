/**
 * DefensePage - DEX Price Defense (Alignment)
 */

import { useEffect, useMemo, useState } from "react";
import { AdvancedMetricsCard } from "../components/AdvancedMetricsCard";
import { AlignmentDisplay } from "../components/AlignmentDisplay";
import { GlobalStatusBar, type ServiceStatus } from "../components/GlobalStatusBar";
import { QuoteLadder } from "../components/QuoteLadder";
import { ReadinessScore } from "../components/ReadinessScore";
import { RecentSwaps } from "../components/RecentSwaps";
import { SystemHealthPanel } from "../components/SystemHealthPanel";

interface TokenPriceData {
  token: string;
  lbank?: { bid: number; ask: number; mid: number; ts: string };
  latoken?: { bid: number; ask: number; mid: number; ts: string };
  uniswap?: { price: number; ts: string };
  spread_bps?: number;
}

interface DashboardData {
  ts: string;
  market_state: {
    csr_usdt?: TokenPriceData;
    csr25_usdt?: TokenPriceData;
  };
}

interface HealthData {
  overall_status: string;
  lbank_gateway?: {
    status: string;
    connected: boolean;
    last_message_ts: string;
    reconnect_count?: number;
    errors_last_5m?: number;
    subscription_errors?: Record<string, string>;
  };
  latoken_gateway?: {
    status: string;
    connected: boolean;
    last_message_ts: string;
  };
  uniswap_quote_csr?: { status: string; last_quote_ts: string };
  uniswap_quote_csr25?: { status: string; last_quote_ts: string };
  strategy?: { status: string };
}

interface PriceHistoryPoint {
  ts: string;
  spread_bps: number;
}

interface BackendAlignment {
  market: string;
  cex_mid: number | null;
  dex_exec_price: number | null;
  dex_quote_size_usdt: number | null;
  deviation_pct: number | null;
  band_bps: number;
  status:
    | "ALIGNED"
    | "BUY_ON_DEX"
    | "SELL_ON_DEX"
    | "NO_ACTION"
    | "NOT_SUPPORTED_YET";
  direction: "BUY" | "SELL" | "NONE";
  required_usdt: number | null;
  required_tokens: number | null;
  expected_exec_price: number | null;
  price_impact_pct: number | null;
  network_cost_usd: number | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  ts_cex: string | null;
  ts_dex: number | null;
  reason: string;
  quotes_available: number;
  quotes_valid: number;
}

export function DefensePage() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [alignmentCsr, setAlignmentCsr] = useState<BackendAlignment | null>(
    null
  );
  const [alignmentCsr25, setAlignmentCsr25] = useState<BackendAlignment | null>(
    null
  );
  const [priceHistory, setPriceHistory] = useState<{
    csr_usdt: PriceHistoryPoint[];
    csr25_usdt: PriceHistoryPoint[];
  }>({ csr_usdt: [], csr25_usdt: [] });
  const [lastUpdate, setLastUpdate] = useState(new Date());

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [dashRes, healthRes] = await Promise.all([
          fetch("/api/dashboard"),
          fetch("/api/health"),
        ]);

        if (dashRes.ok) {
          const data = await dashRes.json();
          setDashboard(data);
          setLastUpdate(new Date());

          if (data.market_state?.csr_usdt?.spread_bps !== undefined) {
            setPriceHistory((prev) => ({
              ...prev,
              csr_usdt: [
                ...prev.csr_usdt.slice(-19),
                {
                  ts: data.ts,
                  spread_bps: data.market_state.csr_usdt.spread_bps,
                },
              ],
            }));
          }
          if (data.market_state?.csr25_usdt?.spread_bps !== undefined) {
            setPriceHistory((prev) => ({
              ...prev,
              csr25_usdt: [
                ...prev.csr25_usdt.slice(-19),
                {
                  ts: data.ts,
                  spread_bps: data.market_state.csr25_usdt.spread_bps,
                },
              ],
            }));
          }
        }

        if (healthRes.ok) setHealth(await healthRes.json());

        try {
          const res = await fetch("/api/alignment/CSR");
          if (res.ok) setAlignmentCsr(await res.json());
        } catch {
          /* ignore */
        }

        try {
          const res = await fetch("/api/alignment/CSR25");
          if (res.ok) setAlignmentCsr25(await res.json());
        } catch {
          /* ignore */
        }
      } catch (err) {
        console.error("Failed to fetch data:", err);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const serviceStatus = useMemo((): ServiceStatus[] => {
    // This function builds a list of service statuses from the health and dashboard data.
    // It is memoized to prevent re-calculation on every render, which occurs every 5 seconds.
    // The dependencies are `health`, `dashboard`, and `lastUpdate`, so this will only re-run when the data changes.
    const now = lastUpdate.getTime();
    const services: ServiceStatus[] = [];

    // LBank Gateway - CEX for CSR25
    const lbankTs = health?.lbank_gateway?.last_message_ts;
    const lbankAge = lbankTs
      ? Math.floor((now - new Date(lbankTs).getTime()) / 1000)
      : undefined;
    const lbankConnected = health?.lbank_gateway?.connected;
    const lbankStatus = health?.lbank_gateway?.status;
    services.push({
      name: "LBank",
      status:
        lbankStatus === "healthy"
          ? "ok"
          : lbankConnected === false
          ? "error"
          : "warning",
      lastUpdate: lbankTs || "",
      ageSeconds: lbankAge,
      isStale: lbankAge !== undefined && lbankAge > 30,
      reason: !lbankConnected
        ? "WebSocket disconnected"
        : lbankAge && lbankAge > 30
        ? "Data stale"
        : undefined,
      details: {
        connected: lbankConnected,
        reconnectCount: health?.lbank_gateway?.reconnect_count,
        errorsLast5m: health?.lbank_gateway?.errors_last_5m,
        lastMessageTs: lbankTs,
        subscriptionErrors: health?.lbank_gateway?.subscription_errors,
      },
    });

    // LATOKEN Gateway - CEX for CSR
    const latokenTs = health?.latoken_gateway?.last_message_ts;
    const latokenAge = latokenTs
      ? Math.floor((now - new Date(latokenTs).getTime()) / 1000)
      : undefined;
    const latokenConnected = health?.latoken_gateway?.connected;
    const latokenStatus = health?.latoken_gateway?.status;
    services.push({
      name: "LATOKEN",
      status:
        latokenStatus === "healthy"
          ? "ok"
          : latokenConnected === false
          ? "error"
          : "warning",
      lastUpdate: latokenTs || "",
      ageSeconds: latokenAge,
      isStale: latokenAge !== undefined && latokenAge > 30,
      reason: !latokenConnected
        ? "Polling stopped"
        : latokenAge && latokenAge > 30
        ? "Data stale"
        : undefined,
      details: {
        connected: latokenConnected,
        lastMessageTs: latokenTs,
      },
    });

    // DEX CSR - Uniswap scraper for CSR token
    const dexCsrTs = health?.uniswap_quote_csr?.last_quote_ts;
    const dexCsrAge = dexCsrTs
      ? Math.floor((now - new Date(dexCsrTs).getTime()) / 1000)
      : undefined;
    services.push({
      name: "DEX CSR",
      status:
        health?.uniswap_quote_csr?.status === "healthy" ? "ok" : "warning",
      lastUpdate: dexCsrTs || "",
      ageSeconds: dexCsrAge,
      isStale: dexCsrAge !== undefined && dexCsrAge > 60,
      reason:
        dexCsrAge && dexCsrAge > 60
          ? "Quote stale - scraper may be slow"
          : undefined,
      details: {
        lastMessageTs: dexCsrTs,
      },
    });

    // DEX CSR25 - Uniswap scraper for CSR25 token
    const dexCsr25Ts = health?.uniswap_quote_csr25?.last_quote_ts;
    const dexCsr25Age = dexCsr25Ts
      ? Math.floor((now - new Date(dexCsr25Ts).getTime()) / 1000)
      : undefined;
    services.push({
      name: "DEX CSR25",
      status:
        health?.uniswap_quote_csr25?.status === "healthy" ? "ok" : "warning",
      lastUpdate: dexCsr25Ts || "",
      ageSeconds: dexCsr25Age,
      isStale: dexCsr25Age !== undefined && dexCsr25Age > 60,
      reason:
        dexCsr25Age && dexCsr25Age > 60
          ? "Quote stale - scraper may be slow"
          : undefined,
      details: {
        lastMessageTs: dexCsr25Ts,
      },
    });

    // Strategy Engine
    services.push({
      name: "Strategy",
      status: health?.strategy?.status === "healthy" ? "ok" : "warning",
      lastUpdate: dashboard?.ts || "",
      ageSeconds: dashboard?.ts
        ? Math.floor((now - new Date(dashboard.ts).getTime()) / 1000)
        : undefined,
    });

    return services;
  }, [health, dashboard, lastUpdate]);

  const getCexPrice = (token: "CSR" | "CSR25"): number => {
    if (token === "CSR")
      return dashboard?.market_state?.csr_usdt?.latoken?.mid || 0;
    return dashboard?.market_state?.csr25_usdt?.lbank?.mid || 0;
  };

  const getDexPrice = (token: "CSR" | "CSR25"): number => {
    if (token === "CSR")
      return dashboard?.market_state?.csr_usdt?.uniswap?.price || 0;
    return dashboard?.market_state?.csr25_usdt?.uniswap?.price || 0;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <GlobalStatusBar
        services={serviceStatus}
        lastDataUpdate={lastUpdate}
      />

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* System Health + Readiness Score */}
        <div className="mb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SystemHealthPanel />
          <ReadinessScore />
        </div>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">🛡️ DEX Price Defense</h1>
          <p className="text-slate-400 text-sm mt-1">
            Keep Uniswap prices aligned with CEX reference prices
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-300">CSR / USDT</h2>
            <AlignmentDisplay
              token="CSR"
              alignment={alignmentCsr}
              onExecute={() => {}}
              executionMode="MANUAL"
            />
            <QuoteLadder token="CSR" />
            <AdvancedMetricsCard
              token="CSR"
              cexPrice={getCexPrice("CSR")}
              dexPrice={getDexPrice("CSR")}
              deviationHistory={priceHistory.csr_usdt.map((p) => ({
                timestamp: new Date(p.ts).getTime(),
                deviationBps: p.spread_bps,
              }))}
              transactions={[]}
            />
            <RecentSwaps token="CSR" />
          </div>

          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-300">
              CSR25 / USDT
            </h2>
            <AlignmentDisplay
              token="CSR25"
              alignment={alignmentCsr25}
              onExecute={() => {}}
              executionMode="MANUAL"
            />
            <QuoteLadder token="CSR25" />
            <AdvancedMetricsCard
              token="CSR25"
              cexPrice={getCexPrice("CSR25")}
              dexPrice={getDexPrice("CSR25")}
              deviationHistory={priceHistory.csr25_usdt.map((p) => ({
                timestamp: new Date(p.ts).getTime(),
                deviationBps: p.spread_bps,
              }))}
              transactions={[]}
            />
            <RecentSwaps token="CSR25" />
          </div>
        </div>
      </div>
    </div>
  );
}
