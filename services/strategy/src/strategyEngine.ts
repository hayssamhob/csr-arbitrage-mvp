import { Config } from './config';
import {
    LBankTickerEvent,
    StrategyDecision,
    UniswapQuoteResult,
} from './schemas';

// ============================================================================
// Strategy Engine
// DRY-RUN ONLY: Computes edge after costs and logs decisions
// Per architecture.md: never executes trades in MVP
// ============================================================================

type LogFn = (level: string, event: string, data?: Record<string, unknown>) => void;

export interface MarketState {
  lbankTicker: LBankTickerEvent | null;
  uniswapQuote: UniswapQuoteResult | null;
  lastLbankUpdate: string | null;
  lastUniswapUpdate: string | null;
}

export class StrategyEngine {
  private readonly config: Config;
  private readonly onLog: LogFn;
  private readonly onDecision: (decision: StrategyDecision) => void;
  
  private state: MarketState = {
    lbankTicker: null,
    uniswapQuote: null,
    lastLbankUpdate: null,
    lastUniswapUpdate: null,
  };

  constructor(
    config: Config,
    onLog: LogFn,
    onDecision: (decision: StrategyDecision) => void
  ) {
    this.config = config;
    this.onLog = onLog;
    this.onDecision = onDecision;
  }

  // Update LBank ticker data
  updateLBankTicker(ticker: LBankTickerEvent): void {
    // Filter by configured symbol
    if (ticker.symbol.toLowerCase() !== this.config.SYMBOL.toLowerCase()) {
      return;
    }

    this.state.lbankTicker = ticker;
    this.state.lastLbankUpdate = new Date().toISOString();
    
    this.onLog('debug', 'lbank_ticker_updated', {
      symbol: ticker.symbol,
      bid: ticker.bid,
      ask: ticker.ask,
    });

    // Evaluate strategy on each ticker update
    this.evaluate();
  }

  // Update Uniswap quote data
  updateUniswapQuote(quote: UniswapQuoteResult): void {
    this.state.uniswapQuote = quote;
    this.state.lastUniswapUpdate = new Date().toISOString();
    
    this.onLog('debug', 'uniswap_quote_updated', {
      pair: quote.pair,
      effectivePrice: quote.effective_price_usdt,
      isStale: quote.is_stale,
    });

    // Evaluate strategy on each quote update
    this.evaluate();
  }

  // Get current market state (for health endpoint)
  getState(): MarketState {
    return { ...this.state };
  }

  // Check if data is stale
  isDataStale(): boolean {
    const now = Date.now();
    const maxStaleMs = this.config.MAX_STALENESS_SECONDS * 1000;

    if (!this.state.lastLbankUpdate || !this.state.lastUniswapUpdate) {
      return true;
    }

    const lbankAge = now - new Date(this.state.lastLbankUpdate).getTime();
    const uniswapAge = now - new Date(this.state.lastUniswapUpdate).getTime();

    return lbankAge > maxStaleMs || uniswapAge > maxStaleMs;
  }

  // Main evaluation logic
  private evaluate(): void {
    const { lbankTicker, uniswapQuote } = this.state;

    // Need both data sources
    if (!lbankTicker || !uniswapQuote) {
      this.onLog("debug", "evaluation_skipped", { reason: "incomplete_data" });
      return;
    }

    // Check for stale data
    if (this.isDataStale()) {
      this.onLog("warn", "evaluation_skipped", { reason: "stale_data" });
      return;
    }

    // Check for quote errors
    if (uniswapQuote.error) {
      this.onLog("warn", "evaluation_skipped", {
        reason: "quote_error",
        error: uniswapQuote.error,
      });
      return;
    }

    // Check if quote is validated
    if (uniswapQuote.validated === false) {
      this.onLog("warn", "strategy.skipped", {
        reason: "invalid_or_unvalidated_quote",
      });
      return;
    }

    // Check if quote is from real on-chain data
    if (uniswapQuote.source !== "uniswap_onchain") {
      this.onLog("warn", "strategy.skipped", {
        reason: "non_real_or_invalid_uniswap_quote",
        source: uniswapQuote.source,
      });
      return;
    }

    // Calculate spreads and edge
    const decision = this.calculateDecision(lbankTicker, uniswapQuote);

    // Log and emit decision
    this.onLog("info", "strategy_decision", {
      would_trade: decision.would_trade,
      direction: decision.direction,
      edge_bps: decision.edge_after_costs_bps,
      reason: decision.reason,
    });

    this.onDecision(decision);
  }

  private calculateDecision(
    ticker: LBankTickerEvent,
    quote: UniswapQuoteResult
  ): StrategyDecision {
    const now = new Date().toISOString();
    const uniswapPrice = quote.effective_price_usdt;
    const lbankBid = ticker.bid;
    const lbankAsk = ticker.ask;

    // Calculate spreads in basis points
    // Scenario 1: Buy on CEX (at ask), sell on DEX
    // Profit if DEX price > CEX ask
    const spreadBuyCexSellDex = ((uniswapPrice - lbankAsk) / lbankAsk) * 10000;

    // Scenario 2: Buy on DEX, sell on CEX (at bid)
    // Profit if CEX bid > DEX price
    const spreadBuyDexSellCex = ((lbankBid - uniswapPrice) / uniswapPrice) * 10000;

    // Determine best direction
    let rawSpreadBps: number;
    let direction: StrategyDecision['direction'];

    if (spreadBuyCexSellDex > spreadBuyDexSellCex && spreadBuyCexSellDex > 0) {
      rawSpreadBps = spreadBuyCexSellDex;
      direction = 'buy_cex_sell_dex';
    } else if (spreadBuyDexSellCex > 0) {
      rawSpreadBps = spreadBuyDexSellCex;
      direction = 'buy_dex_sell_cex';
    } else {
      rawSpreadBps = Math.max(spreadBuyCexSellDex, spreadBuyDexSellCex);
      direction = 'none';
    }

    // Calculate edge after costs
    const estimatedCostBps = this.config.ESTIMATED_COST_BPS;
    const edgeAfterCostsBps = rawSpreadBps - estimatedCostBps;

    // Determine if we would trade
    const wouldTrade = edgeAfterCostsBps >= this.config.MIN_EDGE_BPS && direction !== 'none';

    // Calculate suggested size (bounded by max)
    let suggestedSize = 0;
    if (wouldTrade) {
      // Simple sizing: use configured quote size, bounded by max
      suggestedSize = Math.min(this.config.QUOTE_SIZE_USDT, this.config.MAX_TRADE_SIZE_USDT);
    }

    // Build reason string
    let reason: string;
    if (direction === 'none') {
      reason = 'No positive spread opportunity';
    } else if (!wouldTrade) {
      reason = `Edge ${edgeAfterCostsBps.toFixed(1)}bps below threshold ${this.config.MIN_EDGE_BPS}bps`;
    } else {
      reason = `Edge ${edgeAfterCostsBps.toFixed(1)}bps exceeds threshold, direction: ${direction}`;
    }

    return {
      type: 'strategy.decision',
      ts: now,
      symbol: ticker.symbol,
      lbank_bid: lbankBid,
      lbank_ask: lbankAsk,
      uniswap_price: uniswapPrice,
      raw_spread_bps: Math.round(rawSpreadBps * 100) / 100,
      estimated_cost_bps: estimatedCostBps,
      edge_after_costs_bps: Math.round(edgeAfterCostsBps * 100) / 100,
      would_trade: wouldTrade,
      direction,
      suggested_size_usdt: suggestedSize,
      reason,
    };
  }
}
