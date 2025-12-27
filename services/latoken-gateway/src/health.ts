import express, { Express, Request, Response } from 'express';
import { Config } from './config';
import { LatokenClient } from './latokenClient';

// ============================================================================
// Health endpoints for Latoken Gateway
// Per architecture.md: /health, /ready, /metrics (optional)
// ============================================================================

interface HealthState {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  ts: string;
  last_data_ts: string | null;
  is_stale: boolean;
  running: boolean;
  symbols: string[];
  subscription_errors?: Record<string, string>;
}

export function createHealthServer(
  client: LatokenClient,
  config: Config,
  symbols: string[]
): Express {
  const app = express();

  // Health check - basic liveness
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ 
      status: 'ok', 
      service: 'latoken-gateway', 
      ts: new Date().toISOString() 
    });
  });

  // Ready check - detailed health including staleness
  app.get('/ready', (_req: Request, res: Response) => {
    const now = Date.now();
    const lastTs = client.lastDataTimestamp;
    const lastTsMs = lastTs ? new Date(lastTs).getTime() : 0;
    const stalenessMs = lastTs ? now - lastTsMs : Infinity;
    const isStale = stalenessMs > config.MAX_STALENESS_SECONDS * 1000;

    let status: HealthState['status'] = 'healthy';
    if (!client.isRunning) {
      status = 'unhealthy';
    } else if (isStale) {
      status = 'degraded';
    }

    const health: HealthState = {
      service: 'latoken-gateway',
      status,
      ts: new Date().toISOString(),
      last_data_ts: lastTs,
      is_stale: isStale,
      running: client.isRunning,
      symbols,
    };

    const httpStatus = status === 'healthy' ? 200 : status === 'degraded' ? 200 : 503;
    res.status(httpStatus).json(health);
  });

  // Metrics endpoint (simple JSON for now)
  app.get('/metrics', (_req: Request, res: Response) => {
    const lastTs = client.lastDataTimestamp;
    const lastTsMs = lastTs ? new Date(lastTs).getTime() : 0;
    const stalenessMs = lastTs ? Date.now() - lastTsMs : -1;

    res.json({
      latoken_gateway_running: client.isRunning ? 1 : 0,
      latoken_gateway_staleness_ms: stalenessMs,
      latoken_gateway_symbols_count: symbols.length,
    });
  });

  return app;
}
