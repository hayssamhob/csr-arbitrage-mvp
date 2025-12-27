import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// SQLite Database for Execution Service
// Stores: decisions, paper trades, live trades, audit logs
// ============================================================================

export interface TradeRecord {
  id: string;
  ts: string;
  symbol: string;
  direction: string;
  size_usdt: number;
  edge_bps: number;
  mode: 'paper' | 'live';
  status: 'pending' | 'filled' | 'cancelled' | 'failed';
  fill_price?: number;
  pnl_usdt?: number;
  error?: string;
  idempotency_key: string;
}

export interface DecisionRecord {
  id: string;
  ts: string;
  symbol: string;
  lbank_bid: number;
  lbank_ask: number;
  uniswap_price: number;
  raw_spread_bps: number;
  edge_after_costs_bps: number;
  would_trade: boolean;
  direction: string;
  suggested_size_usdt: number;
  executed: boolean;
}

export class DatabaseWrapper {
  private db: Database.Database;

  constructor(dbPath: string) {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS trades (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        symbol TEXT NOT NULL,
        direction TEXT NOT NULL,
        size_usdt REAL NOT NULL,
        edge_bps REAL NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        fill_price REAL,
        pnl_usdt REAL,
        error TEXT,
        idempotency_key TEXT UNIQUE
      );

      CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        ts TEXT NOT NULL,
        symbol TEXT NOT NULL,
        lbank_bid REAL NOT NULL,
        lbank_ask REAL NOT NULL,
        uniswap_price REAL NOT NULL,
        raw_spread_bps REAL NOT NULL,
        edge_after_costs_bps REAL NOT NULL,
        would_trade INTEGER NOT NULL,
        direction TEXT NOT NULL,
        suggested_size_usdt REAL NOT NULL,
        executed INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);
      CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
      CREATE INDEX IF NOT EXISTS idx_decisions_ts ON decisions(ts);
      CREATE INDEX IF NOT EXISTS idx_decisions_symbol ON decisions(symbol);
    `);
  }

  insertTrade(trade: TradeRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO trades (id, ts, symbol, direction, size_usdt, edge_bps, mode, status, fill_price, pnl_usdt, error, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      trade.id,
      trade.ts,
      trade.symbol,
      trade.direction,
      trade.size_usdt,
      trade.edge_bps,
      trade.mode,
      trade.status,
      trade.fill_price || null,
      trade.pnl_usdt || null,
      trade.error || null,
      trade.idempotency_key
    );
  }

  updateTradeStatus(id: string, status: string, fillPrice?: number, pnl?: number, error?: string): void {
    const stmt = this.db.prepare(`
      UPDATE trades SET status = ?, fill_price = ?, pnl_usdt = ?, error = ? WHERE id = ?
    `);
    stmt.run(status, fillPrice || null, pnl || null, error || null, id);
  }

  insertDecision(decision: DecisionRecord): void {
    const stmt = this.db.prepare(`
      INSERT INTO decisions (id, ts, symbol, lbank_bid, lbank_ask, uniswap_price, raw_spread_bps, edge_after_costs_bps, would_trade, direction, suggested_size_usdt, executed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      decision.id,
      decision.ts,
      decision.symbol,
      decision.lbank_bid,
      decision.lbank_ask,
      decision.uniswap_price,
      decision.raw_spread_bps,
      decision.edge_after_costs_bps,
      decision.would_trade ? 1 : 0,
      decision.direction,
      decision.suggested_size_usdt,
      decision.executed ? 1 : 0
    );
  }

  checkIdempotencyKey(key: string): boolean {
    const stmt = this.db.prepare('SELECT id FROM trades WHERE idempotency_key = ?');
    const result = stmt.get(key);
    return !!result;
  }

  getHistory(limit: number = 50, symbol?: string): TradeRecord[] {
    let query = 'SELECT * FROM trades';
    const params: any[] = [];
    
    if (symbol) {
      query += ' WHERE symbol = ?';
      params.push(symbol);
    }
    
    query += ' ORDER BY ts DESC LIMIT ?';
    params.push(limit);
    
    const stmt = this.db.prepare(query);
    return stmt.all(...params) as TradeRecord[];
  }

  getDailyVolume(): number {
    const today = new Date().toISOString().split('T')[0];
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(size_usdt), 0) as total 
      FROM trades 
      WHERE ts >= ? AND status = 'filled'
    `);
    const result = stmt.get(`${today}T00:00:00.000Z`) as { total: number };
    return result.total;
  }

  getActiveOrderCount(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM trades WHERE status = 'pending'
    `);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  close(): void {
    this.db.close();
  }
}

// Export as Database for compatibility
export { DatabaseWrapper as Database };
