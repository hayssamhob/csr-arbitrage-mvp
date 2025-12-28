import * as fs from "fs";
import * as path from "path";
import puppeteer, { Browser, Page } from "puppeteer";
import { ScraperConfig } from "./config";
import { LogFn, QuoteData, ScrapeError, TokenSymbol } from "./types";

const DEBUG_DIR = "/tmp/uniswap-debug";

// Sanity check bounds (configurable)
const PRICE_CHANGE_THRESHOLD = 0.30; // 30% max change from last good quote

/**
 * Hardened Uniswap UI Scraper
 * 
 * Features:
 * - Enriched output with explicit price calculations
 * - Sanity checks to reject bad reads
 * - Parallel scraping for speed
 * - Gas extraction from UI
 * - Last-known-good quote tracking
 */
export class UniswapScraper {
  private browser: Browser | null = null;
  private pages: Map<TokenSymbol, Page> = new Map();
  private config: ScraperConfig;
  private onLog: LogFn;
  private consecutiveFailures: Map<TokenSymbol, number> = new Map();
  private recentErrors: ScrapeError[] = [];
  private lastSuccessTs: number | null = null;

  // Last known good quotes for sanity checking
  private lastGoodQuotes: Map<string, QuoteData> = new Map();

  // Track if pages are warmed up (first scrape done)
  private warmedUp: Map<TokenSymbol, boolean> = new Map();

  constructor(config: ScraperConfig, onLog: LogFn) {
    this.config = config;
    this.onLog = onLog;
    this.consecutiveFailures.set("CSR", 0);
    this.consecutiveFailures.set("CSR25", 0);
    this.warmedUp.set("CSR", false);
    this.warmedUp.set("CSR25", false);

    if (!fs.existsSync(DEBUG_DIR)) {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
    }
  }

  private async saveScreenshot(
    page: Page,
    token: TokenSymbol,
    stage: string
  ): Promise<string> {
    const filename = `${token}-${stage}-${Date.now()}.png`;
    const filepath = path.join(DEBUG_DIR, filename);
    try {
      await page.screenshot({ path: filepath, fullPage: true });
      return filepath;
    } catch {
      return "";
    }
  }

  private async dismissBlockers(page: Page, token: TokenSymbol): Promise<void> {
    const blockerTexts = [
      "Accept",
      "I agree",
      "Continue",
      "Close",
      "Got it",
      "Dismiss",
      "OK",
    ];
    let dismissed = 0;

    for (let i = 0; i < 3; i++) {
      let foundBlocker = false;
      for (const text of blockerTexts) {
        try {
          const buttons = await page.$$(`button`);
          for (const button of buttons) {
            const buttonText = await button.evaluate(
              (el: Element) => el.textContent || ""
            );
            if (buttonText.toLowerCase().includes(text.toLowerCase())) {
              await button.click();
              dismissed++;
              foundBlocker = true;
              await page.waitForTimeout(200);
            }
          }
        } catch {
          /* ignore */
        }
      }

      try {
        await page.evaluate(() => {
          document.body.style.overflow = "auto";
          const closeSelectors = [
            '[aria-label="Close"]',
            '[data-testid="close-icon"]',
          ];
          for (const sel of closeSelectors) {
            const el = document.querySelector(sel) as HTMLElement;
            if (el) el.click();
          }
        });
      } catch {
        /* ignore */
      }

      if (!foundBlocker) break;
    }

    this.onLog("info", "blockers_dismissed", { token, count: dismissed });
  }

  async initialize(): Promise<void> {
    this.onLog("info", "browser_launching", {
      headless: this.config.headless,
      args: this.config.chromeArgs,
    });

    this.browser = await puppeteer.launch({
      headless: this.config.headless,
      args: this.config.chromeArgs,
      defaultViewport: { width: 1920, height: 1080 },
    });

    // Initialize pages sequentially (parallel causes timeouts on VPS)
    await this.initializePage("CSR");
    await this.initializePage("CSR25");

    this.onLog("info", "browser_initialized", {
      pages: Array.from(this.pages.keys()),
    });

    // Warm-up delay after page load
    this.onLog("info", "warmup_delay", { delayMs: 2000 });
    await new Promise((r) => setTimeout(r, 2000));
  }

  private async initializePage(token: TokenSymbol): Promise<void> {
    if (!this.browser) throw new Error("Browser not initialized");

    const page = await this.browser.newPage();
    await page.setUserAgent(this.config.userAgent);

    if (this.config.blockResources) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["image", "font", "media"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }

    const url = this.config.tokens[token];
    this.onLog("info", "page_navigating", { token, url });

    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.config.uniswapTimeoutMs,
      });

      await this.saveScreenshot(page, token, "01-after-load");
      this.onLog("info", "page_loaded", { token });

      await this.dismissBlockers(page, token);
      await this.saveScreenshot(page, token, "02-after-blockers");

      this.pages.set(token, page);
    } catch (error) {
      this.onLog("error", "page_load_failed", {
        token,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Scrape quotes for a token with all configured sizes
   */
  async scrapeToken(token: TokenSymbol, sizes: number[]): Promise<QuoteData[]> {
    const quotes: QuoteData[] = [];

    for (const size of sizes) {
      const quote = await this.scrapeQuote(token, size);

      // Apply sanity checks
      const validatedQuote = this.validateQuote(quote, token, size);
      quotes.push(validatedQuote);

      // Small delay between sizes to let UI settle
      await new Promise((r) => setTimeout(r, 200));
    }

    return quotes;
  }

  /**
   * Scrape both tokens sequentially (parallel causes input timeouts)
   */
  async scrapeAll(
    sizes: number[]
  ): Promise<{ csr: QuoteData[]; csr25: QuoteData[] }> {
    // Sequential scraping is more stable than parallel
    const csrQuotes = await this.scrapeToken("CSR", sizes);
    const csr25Quotes = await this.scrapeToken("CSR25", sizes);

    return { csr: csrQuotes, csr25: csr25Quotes };
  }

  /**
   * Validate quote against sanity rules
   */
  private validateQuote(
    quote: QuoteData,
    token: TokenSymbol,
    size: number
  ): QuoteData {
    const key = `${token}_${size}`;
    const lastGood = this.lastGoodQuotes.get(key);

    // Rule 1: Reject zero/NaN output
    if (
      !quote.valid ||
      quote.amountOutToken <= 0 ||
      isNaN(quote.amountOutToken)
    ) {
      return quote; // Already invalid
    }

    // Rule 2: Check price change vs last good (if exists)
    if (lastGood && lastGood.price_usdt_per_token > 0) {
      const priceChange =
        Math.abs(quote.price_usdt_per_token - lastGood.price_usdt_per_token) /
        lastGood.price_usdt_per_token;

      if (priceChange > PRICE_CHANGE_THRESHOLD) {
        this.onLog("warn", "quote_rejected_price_change", {
          token,
          size,
          newPrice: quote.price_usdt_per_token,
          lastPrice: lastGood.price_usdt_per_token,
          changePercent: (priceChange * 100).toFixed(1),
        });

        // Return last good quote instead
        return {
          ...lastGood,
          reason: `price_change_rejected: ${(priceChange * 100).toFixed(
            1
          )}% change`,
        };
      }
    }

    // Quote passed sanity checks - update last known good
    this.lastGoodQuotes.set(key, quote);
    return quote;
  }

  /**
   * Check for error states in the UI (insufficient liquidity, no route, etc.)
   */
  private async checkErrorState(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        const errorPatterns = [
          "insufficient liquidity",
          "no route",
          "price impact too high",
          "unable to quote",
          "error fetching",
          "token not found",
          "pool not found",
        ];
        const bodyText = document.body.innerText.toLowerCase();
        for (const pattern of errorPatterns) {
          if (bodyText.includes(pattern)) {
            return pattern;
          }
        }
        return null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Scrape single quote - fast fail with timeout and error detection
   */
  async scrapeQuote(
    token: TokenSymbol,
    amountUsdt: number
  ): Promise<QuoteData> {
    const page = this.pages.get(token);
    if (!page) {
      return this.createInvalidQuote(
        token,
        amountUsdt,
        "selector_missing",
        "Page not initialized",
        0
      );
    }

    const startTime = Date.now();
    const perQuoteTimeout = 5000; // 5 second max per quote

    try {
      // Check for error state first (fail-fast)
      const errorState = await this.checkErrorState(page);
      if (errorState) {
        this.onLog("warn", "error_state_detected", {
          token,
          amountUsdt,
          errorState,
        });
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "ui_changed",
          `UI error: ${errorState}`,
          Date.now() - startTime
        );
      }

      // Find input fields
      const inputSelector = 'input[inputmode="decimal"]';
      const inputs = await page.$$(inputSelector);

      if (inputs.length < 2) {
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "selector_missing",
          "Inputs not found",
          Date.now() - startTime
        );
      }

      const inputField = inputs[0];

      // Get output before
      const outputBefore = await this.getOutputValue(page);

      // Set input with timeout
      const inputResult = await Promise.race([
        this.setInputValue(page, inputField, amountUsdt),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Input timeout")), perQuoteTimeout)
        ),
      ]);

      if (inputResult !== "success") {
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "timeout",
          inputResult,
          Date.now() - startTime
        );
      }

      // Wait for output change (max 4s)
      const { value: outputAfter, raw: outputRaw } =
        await this.waitForOutputChange(page, outputBefore, 4000);

      // Check for error state after input (insufficient liquidity may appear now)
      const postErrorState = await this.checkErrorState(page);
      if (postErrorState) {
        this.onLog("warn", "post_input_error_detected", {
          token,
          amountUsdt,
          errorState: postErrorState,
        });
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "ui_changed",
          `UI error after input: ${postErrorState}`,
          Date.now() - startTime
        );
      }

      if (outputAfter === null || outputAfter <= 0) {
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "timeout",
          "Output unchanged",
          Date.now() - startTime
        );
      }

      // Extract gas estimate
      const { gasUsdt, gasRaw } = await this.extractGas(page);

      // Calculate prices
      const scrapeMs = Date.now() - startTime;
      const price_usdt_per_token = amountUsdt / outputAfter;
      const price_token_per_usdt = outputAfter / amountUsdt;

      this.consecutiveFailures.set(token, 0);
      this.lastSuccessTs = Date.now();
      this.warmedUp.set(token, true);

      this.onLog("info", "quote_scraped", {
        token,
        amountUsdt,
        outputAfter,
        price_usdt_per_token: price_usdt_per_token.toFixed(6),
        scrapeMs,
      });

      return {
        market: `${token}_USDT`,
        inputToken: "USDT",
        outputToken: token,
        amountInUSDT: amountUsdt,
        amountInRaw: amountUsdt.toString(),
        amountOutToken: outputAfter,
        amountOutRaw: outputRaw || outputAfter.toString(),
        price_usdt_per_token,
        price_token_per_usdt,
        usdt_for_1_token: price_usdt_per_token,
        gasEstimateUsdt: gasUsdt,
        gasRaw: gasRaw,
        route: "Uniswap UI",
        ts: Math.floor(Date.now() / 1000),
        scrapeMs,
        valid: true,
      };
    } catch (error) {
      const scrapeMs = Date.now() - startTime;
      const failures = (this.consecutiveFailures.get(token) || 0) + 1;
      this.consecutiveFailures.set(token, failures);

      this.onLog("error", "scrape_failed", {
        token,
        amountUsdt,
        scrapeMs,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.createInvalidQuote(
        token,
        amountUsdt,
        "unknown",
        error instanceof Error ? error.message : String(error),
        scrapeMs
      );
    }
  }

  /**
   * Set input value with proper React event dispatching
   */
  private async setInputValue(
    page: Page,
    inputField: any,
    value: number
  ): Promise<string> {
    try {
      // Click to focus and triple-click to select all
      await inputField.click({ clickCount: 3 });

      // Small delay for UI to register selection
      await new Promise((r) => setTimeout(r, 50));

      // Type the new value (this replaces selection)
      await inputField.type(value.toString(), { delay: 20 });

      // Dispatch React events to trigger state update
      await inputField.evaluate((el: HTMLInputElement, val: string) => {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (setter) setter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.blur();
      }, value.toString());

      // Small delay to let React process
      await new Promise((r) => setTimeout(r, 100));

      return "success";
    } catch (error) {
      return error instanceof Error ? error.message : "input_failed";
    }
  }

  /**
   * Get output value with raw text
   */
  private async getOutputValue(page: Page): Promise<number | null> {
    try {
      return await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[inputmode="decimal"]');
        if (inputs.length >= 2) {
          const output = inputs[1] as HTMLInputElement;
          const raw = output.value.replace(/,/g, "").trim();
          return raw ? parseFloat(raw) : null;
        }
        return null;
      });
    } catch {
      return null;
    }
  }

  /**
   * Wait for output to change with raw value extraction
   */
  private async waitForOutputChange(
    page: Page,
    originalValue: number | null,
    maxWaitMs: number
  ): Promise<{ value: number | null; raw: string | null }> {
    const startTime = Date.now();
    const checkInterval = 250;

    while (Date.now() - startTime < maxWaitMs) {
      const result = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[inputmode="decimal"]');
        if (inputs.length >= 2) {
          const output = inputs[1] as HTMLInputElement;
          const raw = output.value;
          const cleaned = raw.replace(/,/g, "").trim();
          return { raw, value: cleaned ? parseFloat(cleaned) : null };
        }
        return { raw: null, value: null };
      });

      if (result.value !== null && result.value > 0) {
        if (originalValue === null || result.value !== originalValue) {
          return result;
        }
      }

      await page.waitForTimeout(checkInterval);
    }

    return { value: null, raw: null };
  }

  /**
   * Extract gas estimate from UI
   */
  private async extractGas(
    page: Page
  ): Promise<{ gasUsdt: number | null; gasRaw: string | null }> {
    try {
      const result = await page.evaluate(() => {
        // Look for gas-related text patterns
        const gasPatterns = [
          /\$[\d.,]+\s*gas/i,
          /gas[:\s]*\$[\d.,]+/i,
          /network fee[:\s]*\$[\d.,]+/i,
          /~\$[\d.,]+/,
        ];

        const allText = document.body.innerText;

        for (const pattern of gasPatterns) {
          const match = allText.match(pattern);
          if (match) {
            const numMatch = match[0].match(/[\d.,]+/);
            if (numMatch) {
              return {
                raw: match[0],
                value: parseFloat(numMatch[0].replace(/,/g, "")),
              };
            }
          }
        }

        return { raw: null, value: null };
      });

      return {
        gasUsdt: result.value,
        gasRaw: result.raw,
      };
    } catch {
      return { gasUsdt: null, gasRaw: null };
    }
  }

  private createInvalidQuote(
    token: TokenSymbol,
    amountUsdt: number,
    reason: ScrapeError["type"],
    message: string,
    scrapeMs: number
  ): QuoteData {
    return {
      market: `${token}_USDT`,
      inputToken: "USDT",
      outputToken: token,
      amountInUSDT: amountUsdt,
      amountInRaw: amountUsdt.toString(),
      amountOutToken: 0,
      amountOutRaw: "0",
      price_usdt_per_token: 0,
      price_token_per_usdt: 0,
      usdt_for_1_token: 0,
      gasEstimateUsdt: null,
      gasRaw: null,
      route: "none",
      ts: Math.floor(Date.now() / 1000),
      scrapeMs,
      valid: false,
      reason: `${reason}: ${message}`,
    };
  }

  async restartBrowser(): Promise<void> {
    this.onLog("warn", "browser_restarting");
    try {
      await this.close();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 2000));
    await this.initialize();
    this.consecutiveFailures.set("CSR", 0);
    this.consecutiveFailures.set("CSR25", 0);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.pages.clear();
    }
  }

  getErrorsLast5m(): number {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    return this.recentErrors.filter((e) => e.timestamp > fiveMinAgo).length;
  }

  getLastSuccessTs(): number | null {
    return this.lastSuccessTs;
  }

  getConsecutiveFailures(token: TokenSymbol): number {
    return this.consecutiveFailures.get(token) || 0;
  }
}
