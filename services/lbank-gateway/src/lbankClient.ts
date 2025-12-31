import { EventEmitter } from 'events';
import WebSocket from 'ws';
import {
  LBankDepthEvent,
  LBankErrorMessageSchema,
  LBankPingSchema,
  LBankTickerEvent,
  RawLBankDepthSchema,
  RawLBankTickerSchema,
} from "./schemas";

// ============================================================================
// LBank WebSocket Client
// Connects to LBank WS, handles reconnection, normalizes data
// Reference: https://www.lbank.com/en-US/docs/
// ============================================================================

interface LBankClientOptions {
  wsUrl: string;
  symbols: string[];
  maxReconnectAttempts?: number;
  reconnectIntervalMs?: number;
  pingIntervalMs?: number;
  onLog: (level: string, event: string, data?: Record<string, unknown>) => void;
}

export class LBankClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly wsUrl: string;
  private readonly symbols: string[];
  private readonly maxReconnectAttempts: number;
  private readonly reconnectIntervalMs: number;
  private readonly pingIntervalMs: number;
  private readonly onLog: LBankClientOptions["onLog"];
  private readonly subscriptionErrors: Map<string, string> = new Map();

  private reconnectAttempts = 0;
  private reconnectCount = 0; // Total reconnections since start
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isConnected = false;
  private lastMessageTs: string | null = null;

  constructor(options: LBankClientOptions) {
    super();
    this.wsUrl = options.wsUrl;
    this.symbols = options.symbols;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 100; // Increased for persistent reconnection
    this.reconnectIntervalMs = options.reconnectIntervalMs ?? 5000;
    this.pingIntervalMs = options.pingIntervalMs ?? 15000; // Reduced to 15s for better keep-alive
    this.onLog = options.onLog;
  }

  // Getters for health status
  get connected(): boolean {
    return this.isConnected;
  }

  get totalReconnects(): number {
    return this.reconnectCount;
  }

  get lastMessageTimestamp(): string | null {
    return this.lastMessageTs;
  }

  get subscriptionErrorMap(): Record<string, string> {
    return Object.fromEntries(this.subscriptionErrors.entries());
  }

  connect(): void {
    if (this.isConnecting || this.isConnected) {
      this.onLog("warn", "connect_skipped", {
        reason: "already connecting or connected",
      });
      return;
    }

    this.isConnecting = true;
    this.onLog("info", "connecting", {
      url: this.wsUrl,
      symbols: this.symbols,
    });

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on("open", () => this.handleOpen());
      this.ws.on("message", (data: WebSocket.RawData) =>
        this.handleMessage(data)
      );
      this.ws.on("close", (code: number, reason: Buffer) =>
        this.handleClose(code, reason.toString())
      );
      this.ws.on("error", (err: Error) => this.handleError(err));
    } catch (err) {
      this.onLog("error", "connect_exception", { error: String(err) });
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.onLog("info", "disconnecting");
    this.clearTimers();

    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close(1000, "Client disconnect");
      }
      this.ws = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
  }

  private handleOpen(): void {
    this.isConnecting = false;
    this.isConnected = true;
    this.reconnectAttempts = 0;

    this.onLog("info", "connected", { url: this.wsUrl });

    // Subscribe to channels
    this.subscribeToChannels();

    // Start ping interval
    this.startPing();

    this.emit("connected");
  }

  private subscribeToChannels(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    for (const symbol of this.symbols) {
      // LBank V2 WebSocket subscription format per official docs
      // https://www.lbank.com/en-US/docs/index.html#websocket-api

      // Subscribe to ticker (kbar channel with 1min for real-time updates)
      const tickerSub = JSON.stringify({
        action: "subscribe",
        subscribe: "tick",
        pair: symbol.toLowerCase(),
      });
      this.ws.send(tickerSub);
      this.onLog("debug", "subscribe_sent", { channel: "tick", symbol });

      // Subscribe to depth
      const depthSub = JSON.stringify({
        action: "subscribe",
        subscribe: "depth",
        depth: "20",
        pair: symbol,
      });
      this.ws.send(depthSub);
      this.onLog("debug", "subscribe_sent", { channel: "depth", symbol });

      // Also subscribe to trade for real-time price updates
      const tradeSub = JSON.stringify({
        action: "subscribe",
        subscribe: "trade",
        pair: symbol,
      });
      this.ws.send(tradeSub);
      this.onLog("debug", "subscribe_sent", { channel: "trade", symbol });
    }
  }

  private handleMessage(data: WebSocket.RawData): void {
    const now = new Date().toISOString();
    this.lastMessageTs = now;

    let parsed: unknown;
    try {
      parsed = JSON.parse(data.toString());
    } catch (err) {
      this.onLog("warn", "parse_error", {
        error: String(err),
        raw: data.toString().slice(0, 200),
      });
      return;
    }

    // Handle ping - respond with pong
    const pingResult = LBankPingSchema.safeParse(parsed);
    if (pingResult.success) {
      this.sendPong(pingResult.data.ping);
      return;
    }

    // Handle error messages (e.g. invalid pairs)
    const errResult = LBankErrorMessageSchema.safeParse(parsed);
    if (errResult.success) {
      const msg = errResult.data.message;
      const invalidPairsMatch = msg.match(/Invalid order pairs:\[([^\]]+)\]/i);
      if (invalidPairsMatch) {
        const pairs = invalidPairsMatch[1]
          .split(",")
          .map((p) => p.trim().toLowerCase())
          .filter(Boolean);
        for (const p of pairs) {
          this.subscriptionErrors.set(p, msg);
        }
      }

      this.emit("error");
      this.onLog("warn", "lbank_ws_error_message", { message: msg });
      return;
    }

    // Handle ticker data
    const tickerResult = RawLBankTickerSchema.safeParse(parsed);
    if (tickerResult.success) {
      const normalized = this.normalizeTickerData(tickerResult.data, now);
      this.onLog("debug", "ticker_received", {
        symbol: normalized.symbol,
        last: normalized.last,
      });
      this.emit("ticker", normalized);
      return;
    }

    // Handle depth data
    const depthResult = RawLBankDepthSchema.safeParse(parsed);
    if (depthResult.success) {
      const normalized = this.normalizeDepthData(depthResult.data, now);
      this.onLog("debug", "depth_received", {
        symbol: normalized.symbol,
        bids: normalized.bids.length,
      });
      this.emit("depth", normalized);
      return;
    }

    // Log unknown message type for debugging
    // Per docs.md: "Log raw inputs" when behavior is unclear
    this.onLog("debug", "unknown_message", {
      raw: JSON.stringify(parsed).slice(0, 500),
      note: "EXPERIMENTAL - unknown message format",
    });
  }

  private normalizeTickerData(
    raw: {
      tick: {
        latest: string;
        high: string;
        low: string;
        vol: string;
        change: string;
      };
      pair: string;
      TS?: string;
    },
    receiveTs: string
  ): LBankTickerEvent {
    // ASSUMPTION: LBank returns 'latest' as last price
    // Best bid/ask may need to come from depth data
    // Using last price as proxy for bid/ask spread center
    const last = parseFloat(raw.tick.latest);

    // EXPERIMENTAL: Estimating bid/ask from last price
    // In production, use actual depth data for accurate bid/ask
    const estimatedSpread = last * 0.001; // 0.1% spread assumption

    return {
      type: "lbank.ticker",
      symbol: raw.pair.toLowerCase(),
      ts: receiveTs,
      bid: last - estimatedSpread / 2,
      ask: last + estimatedSpread / 2,
      last: last,
      volume_24h: parseFloat(raw.tick.vol),
      source_ts: raw.TS ? new Date(parseInt(raw.TS)).toISOString() : undefined,
    };
  }

  private normalizeDepthData(
    raw: {
      depth: { bids: [string, string][]; asks: [string, string][] };
      pair: string;
      TS?: string;
    },
    receiveTs: string
  ): LBankDepthEvent {
    return {
      type: "lbank.depth",
      symbol: raw.pair.toLowerCase(),
      ts: receiveTs,
      bids: raw.depth.bids.map(([price, qty]) => [
        parseFloat(price),
        parseFloat(qty),
      ]),
      asks: raw.depth.asks.map(([price, qty]) => [
        parseFloat(price),
        parseFloat(qty),
      ]),
      source_ts: raw.TS ? new Date(parseInt(raw.TS)).toISOString() : undefined,
    };
  }

  private sendPong(ping: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      // LBank V2 pong format - just echo back the ping value
      this.ws.send(JSON.stringify({ pong: ping }));
      this.onLog("debug", "pong_sent", { ping });
    }
  }

  private startPing(): void {
    this.clearPingTimer();

    // LBank server sends pings, we respond with pongs
    // Client only needs to monitor for staleness, not send proactive pings
    this.pingTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        // Check for staleness - force reconnect if no data for 60s
        if (this.lastMessageTs) {
          const lastMsgTime = new Date(this.lastMessageTs).getTime();
          const staleMs = Date.now() - lastMsgTime;
          if (staleMs > 60000) {
            this.onLog("warn", "staleness_detected", { staleMs });
            this.ws.close(1000, "Stale connection");
          }
        }
      }
    }, this.pingIntervalMs);
  }

  private handleClose(code: number, reason: string): void {
    this.onLog("warn", "connection_closed", { code, reason });
    this.cleanup();
    this.scheduleReconnect();
  }

  private handleError(err: Error): void {
    this.onLog("error", "websocket_error", { error: err.message });
    // Error will trigger close event, which handles reconnect
  }

  private cleanup(): void {
    this.isConnected = false;
    this.isConnecting = false;
    this.clearPingTimer();

    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = null;
    }

    this.emit("disconnected");
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.onLog("error", "max_reconnect_reached", {
        attempts: this.reconnectAttempts,
        maxAttempts: this.maxReconnectAttempts,
      });
      this.emit("max_reconnect_reached");
      return;
    }

    this.reconnectAttempts++;
    this.reconnectCount++;

    // Exponential backoff with jitter
    const baseDelay =
      this.reconnectIntervalMs * Math.pow(1.5, this.reconnectAttempts - 1);
    const jitter = Math.random() * 1000;
    const delay = Math.min(baseDelay + jitter, 60000); // Cap at 60s

    this.onLog("info", "scheduling_reconnect", {
      attempt: this.reconnectAttempts,
      delayMs: Math.round(delay),
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearTimers(): void {
    this.clearPingTimer();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
}
