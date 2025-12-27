import axios from 'axios';
import { EventEmitter } from 'events';
import { RawLatokenTicker, LatokenTickerEvent } from './schemas';

// ============================================================================
// Latoken REST API Client
// Polls market data and normalizes to internal schema
// ============================================================================

interface LatokenClientOptions {
  apiUrl: string;
  apiKey: string;
  apiSecret: string;
  symbols: string[];
  pollIntervalMs: number;
  onLog: (level: string, event: string, data?: Record<string, unknown>) => void;
}

export class LatokenClient extends EventEmitter {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly symbols: string[];
  private readonly pollIntervalMs: number;
  private readonly onLog: LatokenClientOptions['onLog'];
  
  private pollTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private lastDataTs: string | null = null;

  constructor(options: LatokenClientOptions) {
    super();
    this.apiUrl = options.apiUrl;
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.symbols = options.symbols;
    this.pollIntervalMs = options.pollIntervalMs;
    this.onLog = options.onLog;
  }

  get lastDataTimestamp(): string | null {
    return this.lastDataTs;
  }

  start(): void {
    if (this.isRunning) {
      this.onLog('warn', 'start_skipped', { reason: 'already running' });
      return;
    }

    this.isRunning = true;
    this.onLog('info', 'starting', { symbols: this.symbols, intervalMs: this.pollIntervalMs });
    
    // Start polling
    this.poll();
    this.pollTimer = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (!this.isRunning) {
      this.onLog('warn', 'stop_skipped', { reason: 'not running' });
      return;
    }

    this.isRunning = false;
    this.onLog('info', 'stopping');
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private async poll(): Promise<void> {
    const now = new Date().toISOString();
    
    try {
      // Poll each symbol
      for (const symbol of this.symbols) {
        await this.fetchTicker(symbol, now);
      }
    } catch (error) {
      this.onLog('error', 'poll_error', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      this.emit('error');
    }
  }

  private async fetchTicker(symbol: string, ts: string): Promise<void> {
    try {
      // NOTE: This is a placeholder implementation
      // Actual Latoken API endpoints need to be documented
      // For now, we'll simulate with a mock response structure
      
      const url = `${this.apiUrl}/v1/ticker?symbol=${symbol}`;
      const response = await axios.get(url, {
        headers: {
          'X-API-Key': this.apiKey,
          // Add signature headers if required by Latoken
        },
        timeout: 5000,
      });

      const raw = response.data;
      this.onLog('debug', 'raw_response', { symbol, data: raw });

      // Normalize to internal schema
      const normalized = this.normalizeTickerData(raw, symbol, ts);
      this.emit('ticker', normalized);
      
    } catch (error) {
      this.onLog('warn', 'fetch_ticker_error', { 
        symbol, 
        error: error instanceof Error ? error.message : String(error) 
      });
      
      // Emit a mock ticker with error indication so strategy can see the issue
      const errorTicker: LatokenTickerEvent = {
        type: 'latoken.ticker',
        symbol: symbol.toLowerCase(),
        ts,
        bid: 0,
        ask: 0,
        last: 0,
        volume_24h: 0,
      };
      this.emit('ticker', errorTicker);
    }
  }

  private normalizeTickerData(
    raw: any,
    symbol: string,
    receiveTs: string
  ): LatokenTickerEvent {
    // EXPERIMENTAL: Normalize based on assumed Latoken response format
    // This will need to be adjusted based on actual API documentation
    
    const price = parseFloat(raw.price || '0');
    const bid = parseFloat(raw.bid || raw.price || '0');
    const ask = parseFloat(raw.ask || raw.price || '0');
    const volume = parseFloat(raw.volume || '0');
    
    return {
      type: 'latoken.ticker',
      symbol: symbol.toLowerCase(),
      ts: receiveTs,
      bid,
      ask,
      last: price,
      volume_24h: volume,
      source_ts: raw.timestamp ? new Date(raw.timestamp).toISOString() : undefined,
    };
  }
}
