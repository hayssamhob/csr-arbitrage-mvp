import ccxt from 'ccxt';
import { EventEmitter } from 'events';
import { LatokenTickerEvent } from './schemas';

// ============================================================================
// LATOKEN REST Client using CCXT
// Polls market data via REST API (no STOMP WebSocket complexity)
// ============================================================================

interface LatokenClientOptions {
  apiKey?: string;
  apiSecret?: string;
  symbols: string[];
  pollIntervalMs: number;
  onLog: (level: string, event: string, data?: Record<string, unknown>) => void;
}

interface PairInfo {
  ccxtSymbol: string;
  internalSymbol: string;
  pairId: string;
}

export class LatokenClient extends EventEmitter {
  private readonly exchange: ccxt.latoken;
  private readonly symbols: string[];
  private readonly pollIntervalMs: number;
  private readonly onLog: LatokenClientOptions["onLog"];
  private readonly config: {
    MOCK_MODE: boolean;
    MOCK_BID: number;
    MOCK_ASK: number;
    MOCK_LAST: number;
  };

  private pollTimer: NodeJS.Timeout | null = null;
  private _isRunning = false;
  private lastDataTs: string | null = null;
  private pairMap: Map<string, PairInfo> = new Map();
  private initError: string | null = null;

  constructor(
    options: LatokenClientOptions & {
      config: {
        MOCK_MODE: boolean;
        MOCK_BID: number;
        MOCK_ASK: number;
        MOCK_LAST: number;
      };
    }
  ) {
    super();
    this.symbols = options.symbols.map((s) => s.toLowerCase());
    this.pollIntervalMs = options.pollIntervalMs;
    this.onLog = options.onLog;
    this.config = options.config;

    // Initialize CCXT exchange (public API only for now)
    this.exchange = new ccxt.latoken({
      apiKey: options.apiKey,
      secret: options.apiSecret,
      enableRateLimit: true,
    });
  }

  get lastDataTimestamp(): string | null {
    return this.lastDataTs;
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  get initializationError(): string | null {
    return this.initError;
  }

  async start(): Promise<void> {
    if (this._isRunning) {
      this.onLog("warn", "start_skipped", { reason: "already running" });
      return;
    }

    this._isRunning = true;
    this.onLog("info", "starting", {
      symbols: this.symbols,
      intervalMs: this.pollIntervalMs,
    });

    // Check if mock mode is enabled
    if (this.config.MOCK_MODE) {
      this.onLog("info", "mock_mode_enabled", {
        bid: this.config.MOCK_BID,
        ask: this.config.MOCK_ASK,
        last: this.config.MOCK_LAST,
      });

      // Start mock polling
      await this.pollMock();
      this.pollTimer = setInterval(() => this.pollMock(), this.pollIntervalMs);
      return;
    }

    // Discover pairs first
    await this.discoverPairs();

    if (this.pairMap.size === 0) {
      this.onLog("error", "no_pairs_found", { symbols: this.symbols });
      this.initError = "No matching pairs found on LATOKEN";
      return;
    }

    // Start polling
    await this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (!this._isRunning) {
      this.onLog("warn", "stop_skipped", { reason: "not running" });
      return;
    }

    this._isRunning = false;
    this.onLog("info", "stopping");

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async discoverPairs(): Promise<void> {
    try {
      this.onLog("info", "discovering_pairs", { symbols: this.symbols });

      // Load markets from LATOKEN
      const markets = await this.exchange.loadMarkets();

      for (const symbol of this.symbols) {
        // Parse our internal symbol format (e.g., "csr_usdt")
        const [base, quote] = symbol.split("_").map((s) => s.toUpperCase());
        const ccxtSymbol = `${base}/${quote}`;

        if (markets[ccxtSymbol]) {
          const market = markets[ccxtSymbol];
          this.pairMap.set(symbol, {
            ccxtSymbol,
            internalSymbol: symbol,
            pairId: market.id,
          });
          this.onLog("info", "pair_discovered", {
            internalSymbol: symbol,
            ccxtSymbol,
            pairId: market.id,
          });
        } else {
          this.onLog("warn", "pair_not_found", {
            symbol,
            ccxtSymbol,
            availableCount: Object.keys(markets).length,
          });
        }
      }

      this.onLog("info", "pair_discovery_complete", {
        found: this.pairMap.size,
        requested: this.symbols.length,
      });
    } catch (error) {
      this.onLog("error", "pair_discovery_failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.initError = `Pair discovery failed: ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  }

  private async poll(): Promise<void> {
    for (const [internalSymbol, pairInfo] of this.pairMap) {
      await this.fetchTicker(internalSymbol, pairInfo);
    }
  }

  private async fetchTicker(
    internalSymbol: string,
    pairInfo: PairInfo
  ): Promise<void> {
    const now = new Date().toISOString();

    try {
      const ticker = await this.exchange.fetchTicker(pairInfo.ccxtSymbol);

      this.lastDataTs = now;

      const normalized: LatokenTickerEvent = {
        type: "latoken.ticker",
        symbol: internalSymbol,
        ts: now,
        bid: ticker.bid ?? 0,
        ask: ticker.ask ?? 0,
        last: ticker.last ?? 0,
        volume_24h: ticker.quoteVolume ?? ticker.baseVolume ?? 0,
        source_ts: ticker.timestamp
          ? new Date(ticker.timestamp).toISOString()
          : undefined,
      };

      this.onLog("debug", "ticker_fetched", {
        symbol: internalSymbol,
        bid: normalized.bid,
        ask: normalized.ask,
        last: normalized.last,
      });

      this.emit("ticker", normalized);
    } catch (error) {
      this.onLog("warn", "fetch_ticker_error", {
        symbol: internalSymbol,
        pairId: pairInfo.pairId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.emit("error");
    }
  }

  // Get available pairs for health endpoint
  getAvailablePairs(): string[] {
    if (this.config.MOCK_MODE) {
      return this.symbols; // Return all configured symbols in mock mode
    }
    return Array.from(this.pairMap.keys());
  }

  // Mock polling for testing when API is blocked
  private async pollMock(): Promise<void> {
    const now = new Date().toISOString();

    for (const symbol of this.symbols) {
      const normalized: LatokenTickerEvent = {
        type: "latoken.ticker",
        symbol,
        ts: now,
        bid: this.config.MOCK_BID,
        ask: this.config.MOCK_ASK,
        last: this.config.MOCK_LAST,
        volume_24h: Math.floor(Math.random() * 1000000), // Random volume
        source_ts: now,
      };

      this.onLog("debug", "mock_ticker_generated", {
        symbol,
        bid: normalized.bid,
        ask: normalized.ask,
        last: normalized.last,
      });

      this.emit("ticker", normalized);
    }

    this.lastDataTs = now;
  }
}
