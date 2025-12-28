import express, { Request, Response } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { loadConfig } from "./config";
import { UniswapScraper } from "./scraper";
import { LogFn, QuoteData, ScraperOutput, TokenSymbol } from "./types";

/**
 * Uniswap UI Quote Ingestion Service
 *
 * TEMPORARY SOLUTION for V4 prices until RPC-based quoting is available.
 * - Scrapes Uniswap UI every 10 seconds
 * - Clearly labeled source="ui_scrape"
 * - Fails safe: returns valid=false with reason instead of fake data
 * - NEVER use in LIVE trading mode unless explicitly enabled
 */

// Structured logger
const log: LogFn = (level, event, data = {}) => {
  console.log(
    JSON.stringify({
      level,
      service: "uniswap-scraper",
      event,
      ts: new Date().toISOString(),
      ...data,
    })
  );
};

// Global state
let scraper: UniswapScraper | null = null;
let latestQuotes: Map<string, QuoteData[]> = new Map(); // token -> quotes for all sizes
let scrapeInProgress = false;

async function main() {
  const config = loadConfig();

  log("info", "starting", {
    version: "1.0.0",
    scrapeIntervalMs: config.scrapeIntervalMs,
    quoteSizes: config.quoteSizesUsdt,
    maxStaleness: config.maxStalenessSeconds,
  });

  // Initialize scraper
  scraper = new UniswapScraper(config, log);

  try {
    await scraper.initialize();
    log("info", "scraper_ready");
  } catch (error) {
    log("error", "scraper_init_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    // Continue anyway - will return errors for quote requests
  }

  // Setup Express server
  const app = express();
  app.use(express.json());

  // Health endpoint
  app.get("/health", (_req: Request, res: Response) => {
    const now = Date.now();
    const csrQuotes = latestQuotes.get("CSR") || [];
    const csr25Quotes = latestQuotes.get("CSR25") || [];

    const lastCsrTs = csrQuotes[0]?.ts ? csrQuotes[0].ts * 1000 : 0;
    const lastCsr25Ts = csr25Quotes[0]?.ts ? csr25Quotes[0].ts * 1000 : 0;

    const csrStale = now - lastCsrTs > config.maxStalenessSeconds * 1000;
    const csr25Stale = now - lastCsr25Ts > config.maxStalenessSeconds * 1000;

    res.json({
      status: "ok",
      service: "uniswap-scraper",
      timestamp: new Date().toISOString(),
      scraper: {
        initialized: scraper !== null,
        errorsLast5m: scraper?.getErrorsLast5m() || 0,
        lastSuccessTs: scraper?.getLastSuccessTs(),
      },
      tokens: {
        CSR: {
          quotesCount: csrQuotes.length,
          lastUpdateTs: lastCsrTs,
          isStale: csrStale,
          consecutiveFailures: scraper?.getConsecutiveFailures("CSR") || 0,
        },
        CSR25: {
          quotesCount: csr25Quotes.length,
          lastUpdateTs: lastCsr25Ts,
          isStale: csr25Stale,
          consecutiveFailures: scraper?.getConsecutiveFailures("CSR25") || 0,
        },
      },
    });
  });

  // Get all quotes
  app.get("/quotes", (_req: Request, res: Response) => {
    const output = buildScraperOutput();
    res.json(output);
  });

  // Get quotes for specific token
  app.get("/quotes/:token", (req: Request, res: Response) => {
    const token = req.params.token.toUpperCase() as TokenSymbol;
    if (token !== "CSR" && token !== "CSR25") {
      res.status(400).json({ error: "Invalid token. Use CSR or CSR25" });
      return;
    }

    const quotes = latestQuotes.get(token) || [];
    res.json({
      source: "ui_scrape",
      chainId: 1,
      token,
      quotes,
      meta: {
        errorsLast5m: scraper?.getErrorsLast5m() || 0,
        lastSuccessTs: scraper?.getLastSuccessTs(),
        consecutiveFailures: scraper?.getConsecutiveFailures(token) || 0,
      },
    });
  });

  // Get quote for specific token and size
  app.get("/quote/:token/:size", (req: Request, res: Response) => {
    const token = req.params.token.toUpperCase() as TokenSymbol;
    const size = parseFloat(req.params.size);

    if (token !== "CSR" && token !== "CSR25") {
      res.status(400).json({ error: "Invalid token. Use CSR or CSR25" });
      return;
    }

    const quotes = latestQuotes.get(token) || [];
    const quote = quotes.find((q) => q.amountInUSDT === size);

    if (!quote) {
      res.status(404).json({
        error: `No quote for ${token} at size ${size} USDT`,
        availableSizes: config.quoteSizesUsdt,
      });
      return;
    }

    res.json(quote);
  });

  // Start HTTP server
  app.listen(config.httpPort, () => {
    log("info", "http_server_started", { port: config.httpPort });
  });

  // Setup WebSocket server for streaming
  const wss = new WebSocketServer({ port: config.wsPort });
  const wsClients: Set<WebSocket> = new Set();

  wss.on("connection", (ws: WebSocket) => {
    wsClients.add(ws);
    log("info", "ws_client_connected", { clients: wsClients.size });

    // Send current state immediately
    ws.send(JSON.stringify(buildScraperOutput()));

    ws.on("close", () => {
      wsClients.delete(ws);
      log("info", "ws_client_disconnected", { clients: wsClients.size });
    });
  });

  log("info", "ws_server_started", { port: config.wsPort });

  // Broadcast function
  const broadcast = (data: ScraperOutput) => {
    const message = JSON.stringify(data);
    wsClients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  };

  // Scraping loop
  const scrapeAll = async () => {
    if (scrapeInProgress || !scraper) {
      return;
    }

    scrapeInProgress = true;
    const startTime = Date.now();

    for (const token of ["CSR", "CSR25"] as TokenSymbol[]) {
      const quotes: QuoteData[] = [];

      for (const size of config.quoteSizesUsdt) {
        try {
          const quote = await scraper.scrapeQuote(token, size);
          quotes.push(quote);
        } catch (error) {
          log("error", "scrape_quote_error", {
            token,
            size,
            error: error instanceof Error ? error.message : String(error),
          });
          quotes.push({
            market: `${token}_USDT`,
            inputToken: "USDT",
            outputToken: token,
            amountInUSDT: size,
            amountOutToken: "0",
            effectivePriceUsdtPerToken: 0,
            gasEstimateUsdt: 0,
            route: "none",
            ts: Math.floor(Date.now() / 1000),
            valid: false,
            reason: `scrape_error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          });
        }

        // Small delay between sizes to avoid overwhelming the UI
        await new Promise((resolve) => setTimeout(resolve, 300));
      }

      latestQuotes.set(token, quotes);
    }

    const duration = Date.now() - startTime;
    log("info", "scrape_cycle_complete", {
      durationMs: duration,
      csrQuotes: latestQuotes.get("CSR")?.filter((q) => q.valid).length || 0,
      csr25Quotes:
        latestQuotes.get("CSR25")?.filter((q) => q.valid).length || 0,
    });

    // Broadcast to WebSocket clients
    broadcast(buildScraperOutput());

    scrapeInProgress = false;
  };

  // Initial scrape
  await scrapeAll();

  // Periodic scraping
  setInterval(scrapeAll, config.scrapeIntervalMs);

  // Graceful shutdown
  const shutdown = async () => {
    log("info", "shutting_down");
    if (scraper) {
      await scraper.close();
    }
    wss.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function buildScraperOutput(): ScraperOutput {
  const allQuotes: QuoteData[] = [];

  for (const [, quotes] of latestQuotes) {
    allQuotes.push(...quotes);
  }

  return {
    source: "ui_scrape",
    chainId: 1,
    quotes: allQuotes,
    meta: {
      scrapeMs: 0, // Would need to track this per cycle
      browser: "chromium",
      errorsLast5m: scraper?.getErrorsLast5m() || 0,
      lastSuccessTs: scraper?.getLastSuccessTs() ?? null,
      consecutiveFailures:
        (scraper?.getConsecutiveFailures("CSR") || 0) +
        (scraper?.getConsecutiveFailures("CSR25") || 0),
    },
  };
}

main().catch((error) => {
  log("error", "fatal_error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
