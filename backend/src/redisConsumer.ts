/**
 * Redis Streams Consumer for Backend API
 * Subscribes to market.data stream and updates dashboard state in real-time
 */

import { EventEmitter } from "events";
import Redis from "ioredis";

// Stream topics (must match gateways)
const TOPICS = {
    MARKET_DATA: 'market.data',
    EXECUTION_REQUESTS: 'execution.requests',
    EXECUTION_RESULTS: 'execution.results',
};

const CONSUMER_GROUP = 'backend-api';
const CONSUMER_NAME = `backend-${process.pid}`;

interface MarketTick {
  type:
    | "cex_tick"
    | "dex_quote"
    | "market.tick"
    | "market.quote"
    | "uniswap.quote";
  source: string;
  symbol: string;
  bid?: number;
  ask?: number;
  last?: number;
  volume_24h?: number;
  effective_price_usdt?: number;
  amount_in?: number;
  amount_out?: number;
  gas_estimate_usdt?: number;
  route?: string;
  ts: string;
  tick?: number;
  lp_fee_bps?: number;
}

export interface RedisConsumerEvents {
    tick: (data: MarketTick) => void;
    error: (error: Error) => void;
    connected: () => void;
    disconnected: () => void;
}

export class RedisConsumer extends EventEmitter {
    private redis: Redis | null = null;
    private running = false;
    private reconnectAttempts = 0;
    private readonly maxReconnectAttempts = 10;
    private readonly redisUrl: string;

    constructor(redisUrl: string) {
        super();
        this.redisUrl = redisUrl;
    }

    async start(): Promise<void> {
        if (this.running) return;
        this.running = true;

        try {
            this.redis = new Redis(this.redisUrl, {
                maxRetriesPerRequest: 3,
                lazyConnect: true,
            });

            await this.redis.connect();
            console.log('[RedisConsumer] Connected to Redis');
            this.emit('connected');

            // Create consumer group if it doesn't exist
            try {
                await this.redis.xgroup('CREATE', TOPICS.MARKET_DATA, CONSUMER_GROUP, '0', 'MKSTREAM');
                console.log(`[RedisConsumer] Created consumer group: ${CONSUMER_GROUP}`);
            } catch (err: any) {
                if (!err.message.includes('BUSYGROUP')) {
                    console.warn('[RedisConsumer] Consumer group already exists');
                }
            }

            // Start consuming
            this.consumeLoop();
        } catch (error) {
            console.error('[RedisConsumer] Failed to connect:', error);
            this.emit('error', error as Error);
            this.scheduleReconnect();
        }
    }

    private async consumeLoop(): Promise<void> {
        while (this.running && this.redis) {
            try {
                // Read from stream with 5 second block timeout
                const results = await this.redis.xreadgroup(
                    'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
                    'COUNT', '10',
                    'BLOCK', '5000',
                    'STREAMS', TOPICS.MARKET_DATA,
                    '>'
                );

                if (results && Array.isArray(results)) {
                    for (const streamData of results) {
                        const [, messages] = streamData as [string, [string, string[]][]];
                        for (const [id, fields] of messages) {
                            try {
                                // Parse the message
                                const data = this.parseStreamMessage(fields);
                                if (data) {
                                    this.emit('tick', data);
                                }
                                // Acknowledge the message
                                await this.redis!.xack(TOPICS.MARKET_DATA, CONSUMER_GROUP, id);
                            } catch (parseError) {
                                console.error('[RedisConsumer] Failed to parse message:', parseError);
                            }
                        }
                    }
                }
            } catch (error: any) {
                if (error.message?.includes('NOGROUP')) {
                    // Group was deleted, recreate it
                    try {
                        await this.redis?.xgroup('CREATE', TOPICS.MARKET_DATA, CONSUMER_GROUP, '0', 'MKSTREAM');
                    } catch {
                        // Ignore
                    }
                } else if (this.running) {
                    console.error('[RedisConsumer] Read error:', error.message);
                    this.emit('error', error);
                    break;
                }
            }
        }

        if (this.running) {
            this.scheduleReconnect();
        }
    }

    private parseStreamMessage(fields: string[]): MarketTick | null {
      // Fields come as ['key1', 'value1', 'key2', 'value2', ...]
      const obj: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        obj[fields[i]] = fields[i + 1];
      }

      // Try to parse JSON payload if present (check both 'payload' and 'data' fields)
      const jsonField = obj.payload || obj.data;
      if (jsonField) {
        try {
          const parsed = JSON.parse(jsonField);
          // Normalize the parsed data to our MarketTick format
          return {
            type: parsed.type,
            source: parsed.venue || parsed.source,
            symbol: parsed.symbol,
            bid: parsed.bid,
            ask: parsed.ask,
            last: parsed.last || parsed.price,
            volume_24h: parsed.volume_24h,
            effective_price_usdt: parsed.effective_price_usdt || parsed.price,
            amount_in: parsed.amount_in,
            amount_out: parsed.amount_out,
            gas_estimate_usdt: parsed.gas_estimate_usdt,
            route: parsed.route,
            ts: parsed.ts
              ? new Date(parsed.ts).toISOString()
              : new Date().toISOString(),
            tick: parsed.tick,
            lp_fee_bps: parsed.lp_fee_bps,
          };
        } catch {
          // Not JSON, use raw fields
        }
      }

      // Build tick from raw fields
      return {
        type: obj.type as MarketTick["type"],
        source: obj.source,
        symbol: obj.symbol,
        bid: obj.bid ? parseFloat(obj.bid) : undefined,
        ask: obj.ask ? parseFloat(obj.ask) : undefined,
        last: obj.last ? parseFloat(obj.last) : undefined,
        volume_24h: obj.volume_24h ? parseFloat(obj.volume_24h) : undefined,
        effective_price_usdt: obj.effective_price_usdt
          ? parseFloat(obj.effective_price_usdt)
          : undefined,
        amount_in: obj.amount_in ? parseFloat(obj.amount_in) : undefined,
        amount_out: obj.amount_out ? parseFloat(obj.amount_out) : undefined,
        gas_estimate_usdt: obj.gas_estimate_usdt
          ? parseFloat(obj.gas_estimate_usdt)
          : undefined,
        route: obj.route,
        ts: obj.ts || new Date().toISOString(),
      };
    }

    private scheduleReconnect(): void {
        if (!this.running) return;

        this.reconnectAttempts++;
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            console.error('[RedisConsumer] Max reconnect attempts reached');
            this.emit('disconnected');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        console.log(`[RedisConsumer] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

        setTimeout(() => {
            this.redis?.disconnect();
            this.redis = null;
            this.start();
        }, delay);
    }

    async stop(): Promise<void> {
        this.running = false;
        if (this.redis) {
            await this.redis.quit();
            this.redis = null;
        }
        console.log('[RedisConsumer] Stopped');
    }

    isConnected(): boolean {
        return this.redis?.status === 'ready';
    }
}
