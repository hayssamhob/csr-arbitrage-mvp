import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import { exec } from 'child_process';
import express from 'express';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ============================================================================
// Watchdog Service - TRUE Health Monitoring + Auto-Restart
// Monitors all services for actual functionality, not just process alive
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
const LOG_LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function log(level: LogLevel, event: string, data?: Record<string, unknown>): void {
  const minLevel = (process.env.LOG_LEVEL || 'info') as LogLevel;
  if (LOG_LEVELS[level] < LOG_LEVELS[minLevel]) return;
  
  const entry = {
    level,
    service: 'watchdog',
    event,
    ts: new Date().toISOString(),
    ...data,
  };
  console.log(JSON.stringify(entry));
}

// Service health status
type HealthStatus = 'ok' | 'degraded' | 'down' | 'unknown';

interface ServiceHealth {
  name: string;
  status: HealthStatus;
  lastCheck: string;
  lastSuccess: string | null;
  lastError: string | null;
  uptimeSeconds: number;
  consecutiveFailures: number;
  restartCount: number;
  lastRestart: string | null;
  dependencies: Record<string, HealthStatus>;
  details: Record<string, unknown>;
}

interface ServiceConfig {
  name: string;
  healthUrl: string;
  pm2Name: string;
  downThresholdMs: number;      // Time before DOWN triggers restart
  degradedThresholdMs: number;  // Time before DEGRADED triggers restart
}

// Service configurations
const SERVICES: ServiceConfig[] = [
  {
    name: 'lbank-gateway',
    healthUrl: 'http://localhost:3001/ready',
    pm2Name: 'lbank-gateway',
    downThresholdMs: 20000,       // 20s
    degradedThresholdMs: 60000,   // 60s
  },
  {
    name: 'latoken-gateway',
    healthUrl: 'http://localhost:3006/ready',
    pm2Name: 'latoken-gateway',
    downThresholdMs: 20000,
    degradedThresholdMs: 60000,
  },
  {
    name: 'strategy',
    healthUrl: 'http://localhost:3003/ready',
    pm2Name: 'strategy',
    downThresholdMs: 20000,
    degradedThresholdMs: 60000,
  },
  {
    name: 'uniswap-scraper',
    healthUrl: 'http://localhost:3010/health',
    pm2Name: 'uniswap-scraper',
    downThresholdMs: 30000,
    degradedThresholdMs: 90000,
  },
  {
    name: 'uniswap-quote-csr',
    healthUrl: 'http://localhost:3004/health',
    pm2Name: 'uniswap-quote-csr',
    downThresholdMs: 30000,
    degradedThresholdMs: 90000,
  },
  {
    name: 'uniswap-quote-csr25',
    healthUrl: 'http://localhost:3005/health',
    pm2Name: 'uniswap-quote-csr25',
    downThresholdMs: 30000,
    degradedThresholdMs: 90000,
  },
  {
    name: 'backend',
    healthUrl: 'http://localhost:8001/health',
    pm2Name: 'backend',
    downThresholdMs: 20000,
    degradedThresholdMs: 60000,
  },
];

// State tracking
const serviceStates: Map<string, {
  health: ServiceHealth;
  downSince: number | null;
  degradedSince: number | null;
  startTime: number;
}> = new Map();

// Initialize service states
for (const svc of SERVICES) {
  serviceStates.set(svc.name, {
    health: {
      name: svc.name,
      status: 'unknown',
      lastCheck: new Date().toISOString(),
      lastSuccess: null,
      lastError: null,
      uptimeSeconds: 0,
      consecutiveFailures: 0,
      restartCount: 0,
      lastRestart: null,
      dependencies: {},
      details: {},
    },
    downSince: null,
    degradedSince: null,
    startTime: Date.now(),
  });
}

// Service events log (in-memory, last 100)
interface ServiceEvent {
  ts: string;
  service: string;
  event: 'restart' | 'down' | 'degraded' | 'recovered';
  reason: string;
}
const serviceEvents: ServiceEvent[] = [];
const MAX_EVENTS = 100;

function addEvent(service: string, event: ServiceEvent['event'], reason: string): void {
  const entry: ServiceEvent = {
    ts: new Date().toISOString(),
    service,
    event,
    reason,
  };
  serviceEvents.unshift(entry);
  if (serviceEvents.length > MAX_EVENTS) {
    serviceEvents.pop();
  }
  log('info', 'service_event', { ...entry });
}

// Check health of a single service
async function checkServiceHealth(config: ServiceConfig): Promise<ServiceHealth> {
  const state = serviceStates.get(config.name)!;
  const now = Date.now();
  
  try {
    const response = await axios.get(config.healthUrl, { timeout: 5000 });
    const data = response.data;
    
    // Determine status from response
    let status: HealthStatus = 'ok';
    if (data.status === 'unhealthy' || data.status === 'down') {
      status = 'down';
    } else if (data.status === 'degraded') {
      status = 'degraded';
    } else if (data.status === 'ok' || data.status === 'healthy') {
      status = 'ok';
    }
    
    // Additional checks for TRUE health
    // For gateway services: check if last message is recent
    if (data.last_message_ts) {
      const lastMsgTime = new Date(data.last_message_ts).getTime();
      const staleness = now - lastMsgTime;
      if (staleness > 15000) { // 15s stale
        status = staleness > 60000 ? 'down' : 'degraded';
      }
    }
    
    // Check if connected
    if (data.connected === false) {
      status = 'down';
    }
    
    // Extract dependencies
    const dependencies: Record<string, HealthStatus> = {};
    if (data.ws_connected !== undefined) {
      dependencies['websocket'] = data.ws_connected ? 'ok' : 'down';
    }
    if (data.markets) {
      for (const [market, info] of Object.entries(data.markets as Record<string, any>)) {
        const hasData = info.has_lbank_data || info.has_latoken_data || info.has_uniswap_data;
        dependencies[market] = hasData ? 'ok' : 'down';
      }
    }
    
    // Update state
    const health: ServiceHealth = {
      name: config.name,
      status,
      lastCheck: new Date().toISOString(),
      lastSuccess: status === 'ok' ? new Date().toISOString() : state.health.lastSuccess,
      lastError: status === 'ok' ? null : data.error || state.health.lastError,
      uptimeSeconds: Math.floor((now - state.startTime) / 1000),
      consecutiveFailures: status === 'ok' ? 0 : state.health.consecutiveFailures + 1,
      restartCount: state.health.restartCount,
      lastRestart: state.health.lastRestart,
      dependencies,
      details: {
        is_stale: data.is_stale,
        reconnect_count: data.reconnect_count,
        errors_last_5m: data.errors_last_5m,
        last_message_ts: data.last_message_ts,
        subscription_errors: data.subscription_errors,
      },
    };
    
    // Track status transitions
    if (status === 'down' && state.downSince === null) {
      state.downSince = now;
      addEvent(config.name, 'down', data.error || 'Service down');
    } else if (status === 'degraded' && state.degradedSince === null) {
      state.degradedSince = now;
      addEvent(config.name, 'degraded', 'Service degraded');
    } else if (status === 'ok') {
      if (state.downSince || state.degradedSince) {
        addEvent(config.name, 'recovered', 'Service recovered');
      }
      state.downSince = null;
      state.degradedSince = null;
    }
    
    state.health = health;
    return health;
    
  } catch (err: any) {
    // Request failed - service is DOWN
    const health: ServiceHealth = {
      name: config.name,
      status: 'down',
      lastCheck: new Date().toISOString(),
      lastSuccess: state.health.lastSuccess,
      lastError: err.code === 'ECONNREFUSED' ? 'Connection refused' : err.message,
      uptimeSeconds: Math.floor((now - state.startTime) / 1000),
      consecutiveFailures: state.health.consecutiveFailures + 1,
      restartCount: state.health.restartCount,
      lastRestart: state.health.lastRestart,
      dependencies: {},
      details: { error_code: err.code },
    };
    
    if (state.downSince === null) {
      state.downSince = now;
      addEvent(config.name, 'down', err.message);
    }
    
    state.health = health;
    return health;
  }
}

// Restart a service via PM2
async function restartService(config: ServiceConfig, reason: string): Promise<boolean> {
  const state = serviceStates.get(config.name)!;
  
  log('warn', 'restarting_service', { service: config.name, reason });
  addEvent(config.name, 'restart', reason);
  
  try {
    await execAsync(`pm2 restart ${config.pm2Name}`);
    
    state.health.restartCount++;
    state.health.lastRestart = new Date().toISOString();
    state.startTime = Date.now();
    state.downSince = null;
    state.degradedSince = null;
    
    log('info', 'service_restarted', { service: config.name });
    return true;
  } catch (err: any) {
    log('error', 'restart_failed', { service: config.name, error: err.message });
    return false;
  }
}

// Main health check loop
async function checkAllServices(): Promise<void> {
  const now = Date.now();
  
  for (const config of SERVICES) {
    const health = await checkServiceHealth(config);
    const state = serviceStates.get(config.name)!;
    
    // Check if we need to restart
    let needsRestart = false;
    let reason = '';
    
    if (health.status === 'down' && state.downSince) {
      const downDuration = now - state.downSince;
      if (downDuration > config.downThresholdMs) {
        needsRestart = true;
        reason = `Down for ${Math.round(downDuration / 1000)}s (threshold: ${config.downThresholdMs / 1000}s)`;
      }
    }
    
    if (health.status === 'degraded' && state.degradedSince) {
      const degradedDuration = now - state.degradedSince;
      if (degradedDuration > config.degradedThresholdMs) {
        needsRestart = true;
        reason = `Degraded for ${Math.round(degradedDuration / 1000)}s (threshold: ${config.degradedThresholdMs / 1000}s)`;
      }
    }
    
    if (needsRestart) {
      await restartService(config, reason);
    }
  }
}

// HTTP server for watchdog status
const app = express();
const PORT = parseInt(process.env.HTTP_PORT || '3020');

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'watchdog', ts: new Date().toISOString() });
});

app.get('/status', (_req, res) => {
  const services: ServiceHealth[] = [];
  for (const state of serviceStates.values()) {
    services.push(state.health);
  }
  
  // Overall status
  const allOk = services.every(s => s.status === 'ok');
  const anyDown = services.some(s => s.status === 'down');
  const overallStatus: HealthStatus = anyDown ? 'down' : allOk ? 'ok' : 'degraded';
  
  res.json({
    status: overallStatus,
    ts: new Date().toISOString(),
    services,
    recent_events: serviceEvents.slice(0, 20),
  });
});

app.get('/events', (_req, res) => {
  res.json({ events: serviceEvents });
});

// Manual restart endpoint (for debugging)
app.post('/restart/:service', async (req, res) => {
  const serviceName = req.params.service;
  const config = SERVICES.find(s => s.name === serviceName);
  
  if (!config) {
    return res.status(404).json({ error: 'Service not found' });
  }
  
  const success = await restartService(config, 'Manual restart');
  res.json({ success, service: serviceName });
});

async function main(): Promise<void> {
  log('info', 'starting', { version: '1.0.0', pollIntervalMs: 5000 });
  
  // Start HTTP server
  app.listen(PORT, () => {
    log('info', 'http_server_started', { port: PORT });
  });
  
  // Initial check
  await checkAllServices();
  
  // Poll every 5 seconds
  setInterval(checkAllServices, 5000);
  
  log('info', 'watchdog_started', { services: SERVICES.map(s => s.name) });
}

main().catch(err => {
  log('error', 'startup_failed', { error: String(err) });
  process.exit(1);
});
