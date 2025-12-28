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

  /**
   * Aggressively dismiss ALL blockers - modals, banners, wallet prompts, cookie notices
   * Must be called BEFORE any input interaction
   */
  private async dismissBlockers(
    page: Page,
    token: TokenSymbol
  ): Promise<number> {
    let dismissed = 0;

    // Run multiple passes to catch nested modals
    for (let pass = 0; pass < 5; pass++) {
      const dismissedThisPass = await page.evaluate(() => {
        let count = 0;

        // 1. Close buttons by aria-label
        const closeSelectors = [
          '[aria-label="Close"]',
          '[aria-label="close"]',
          '[aria-label="Dismiss"]',
          '[data-testid="close-icon"]',
          '[data-testid="navbar-close"]',
          'button[aria-label*="close" i]',
          'button[aria-label*="dismiss" i]',
        ];
        for (const sel of closeSelectors) {
          const els = document.querySelectorAll(sel) as NodeListOf<HTMLElement>;
          els.forEach((el) => {
            try {
              el.click();
              count++;
            } catch {}
          });
        }

        // 2. Buttons with dismiss-like text
        const dismissTexts = [
          "accept",
          "i agree",
          "continue",
          "close",
          "got it",
          "dismiss",
          "ok",
          "confirm",
          "understand",
        ];
        const buttons = document.querySelectorAll("button");
        buttons.forEach((btn) => {
          const text = (btn.textContent || "").toLowerCase().trim();
          if (dismissTexts.some((t) => text === t || text.includes(t))) {
            try {
              btn.click();
              count++;
            } catch {}
          }
        });

        // 3. Remove overlay/modal backdrops
        const overlays = document.querySelectorAll(
          '[class*="overlay"], [class*="modal"], [class*="backdrop"], [class*="Overlay"], [class*="Modal"]'
        );
        overlays.forEach((el) => {
          const style = window.getComputedStyle(el);
          if (style.position === "fixed" || style.position === "absolute") {
            try {
              (el as HTMLElement).remove();
              count++;
            } catch {}
          }
        });

        // 4. Ensure body is scrollable
        document.body.style.overflow = "auto";
        document.documentElement.style.overflow = "auto";

        // 5. Click away from any focused element
        if (
          document.activeElement &&
          document.activeElement !== document.body
        ) {
          (document.activeElement as HTMLElement).blur?.();
        }

        return count;
      });

      dismissed += dismissedThisPass;
      if (dismissedThisPass === 0) break;
      await page.waitForTimeout(150);
    }

    this.onLog("info", "blockers_dismissed", { token, count: dismissed });
    return dismissed;
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
   * Scrape single quote - robust with per-step timeouts and structured errors
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
        "page_not_initialized",
        0
      );
    }

    const startTime = Date.now();

    try {
      // STEP 1: Dismiss ALL blockers before any interaction (2s timeout)
      await Promise.race([
        this.dismissBlockers(page, token),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("blocker_dismiss_timeout")), 2000)
        ),
      ]).catch(() => {}); // Continue even if blocker dismiss times out

      // STEP 2: Check for error state (no liquidity, etc)
      const errorState = await this.checkErrorState(page);
      if (errorState) {
        await this.saveScreenshot(page, token, `error-${amountUsdt}`);
        this.onLog("warn", "error_state_detected", {
          token,
          amountUsdt,
          errorState,
        });
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "ui_changed",
          errorState === "insufficient liquidity"
            ? "no_liquidity"
            : `ui_error: ${errorState}`,
          Date.now() - startTime
        );
      }

      // STEP 3: Find input fields (1s timeout)
      const inputSelector = 'input[inputmode="decimal"]';
      let inputs;
      try {
        inputs = await Promise.race([
          page.$$(inputSelector),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("input_find_timeout")), 1000)
          ),
        ]);
      } catch {
        await this.saveScreenshot(page, token, `no-inputs-${amountUsdt}`);
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "selector_missing",
          "input_find_timeout",
          Date.now() - startTime
        );
      }

      if (inputs.length < 2) {
        await this.saveScreenshot(page, token, `inputs-missing-${amountUsdt}`);
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "selector_missing",
          `found_${inputs.length}_inputs_need_2`,
          Date.now() - startTime
        );
      }

      const inputField = inputs[0];

      // STEP 4: Verify input is editable
      const { editable, reason: editableReason } =
        await this.verifyInputEditable(page, inputField);
      if (!editable) {
        await this.saveScreenshot(
          page,
          token,
          `input-not-editable-${amountUsdt}`
        );
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "selector_missing",
          editableReason || "input_not_editable",
          Date.now() - startTime
        );
      }

      // STEP 5: Get output value before setting input
      const outputBefore = await this.getOutputValue(page);

      // STEP 6: Set input value (3s timeout) - NO typing, only native setter
      let inputResult: string;
      try {
        inputResult = await Promise.race([
          this.setInputValue(page, inputField, amountUsdt),
          new Promise<string>((_, reject) =>
            setTimeout(() => reject(new Error("input_set_timeout")), 3000)
          ),
        ]);
      } catch (e) {
        await this.saveScreenshot(page, token, `input-timeout-${amountUsdt}`);
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "timeout",
          "input_set_timeout",
          Date.now() - startTime
        );
      }

      if (inputResult !== "success") {
        await this.saveScreenshot(page, token, `input-failed-${amountUsdt}`);
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "timeout",
          inputResult,
          Date.now() - startTime
        );
      }

      // STEP 7: Wait for output to change (4s timeout)
      const { value: outputAfter, raw: outputRaw } =
        await this.waitForOutputChange(page, outputBefore, 4000);

      // STEP 8: Check for error state after input
      const postErrorState = await this.checkErrorState(page);
      if (postErrorState) {
        await this.saveScreenshot(page, token, `post-error-${amountUsdt}`);
        this.onLog("warn", "post_input_error_detected", {
          token,
          amountUsdt,
          errorState: postErrorState,
        });
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "ui_changed",
          postErrorState === "insufficient liquidity"
            ? "no_liquidity"
            : `post_input_error: ${postErrorState}`,
          Date.now() - startTime
        );
      }

      if (outputAfter === null || outputAfter <= 0) {
        await this.saveScreenshot(page, token, `no-output-${amountUsdt}`);
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "timeout",
          "output_unchanged_or_zero",
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
   * Verify input is editable (not disabled, not readonly, visible)
   */
  private async verifyInputEditable(
    page: Page,
    inputField: any
  ): Promise<{ editable: boolean; reason?: string }> {
    try {
      const state = await inputField.evaluate((el: HTMLInputElement) => {
        const style = window.getComputedStyle(el);
        return {
          disabled: el.disabled,
          readonly: el.readOnly,
          hidden: style.display === "none" || style.visibility === "hidden",
          width: el.offsetWidth,
          height: el.offsetHeight,
          pointerEvents: style.pointerEvents,
        };
      });

      if (state.disabled) return { editable: false, reason: "input_disabled" };
      if (state.readonly) return { editable: false, reason: "input_readonly" };
      if (state.hidden) return { editable: false, reason: "input_hidden" };
      if (state.width === 0 || state.height === 0)
        return { editable: false, reason: "input_zero_size" };
      if (state.pointerEvents === "none")
        return { editable: false, reason: "input_no_pointer_events" };

      return { editable: true };
    } catch (error) {
      return { editable: false, reason: "input_check_failed" };
    }
  }

  /**
   * Set input value using ONLY native setter + event dispatch
   * DO NOT use input.type() - it's unreliable
   *
   * CRITICAL: Must fully reset input to prevent stale quote carryover
   */
  private async setInputValue(
    page: Page,
    inputField: any,
    value: number
  ): Promise<string> {
    try {
      // Step 1: Verify input is editable
      const { editable, reason } = await this.verifyInputEditable(
        page,
        inputField
      );
      if (!editable) {
        return `input_not_editable: ${reason}`;
      }

      // Step 2: CRITICAL - First reset to empty to clear any stale React state
      await inputField.click({ clickCount: 3 }); // Triple-click to select all
      await page.waitForTimeout(30);

      // Use keyboard to delete selected text
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(50);

      // Step 3: Set to "0" first and wait for output to clear
      const resetResult = await inputField.evaluate((el: HTMLInputElement) => {
        try {
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value"
          )?.set;
          if (!setter) return "no_setter";

          // Set to empty string
          setter.call(el, "");
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));

          return "ok";
        } catch (e) {
          return "reset_error: " + String(e);
        }
      });

      if (resetResult !== "ok") {
        return resetResult;
      }

      // Wait for output field to reset (should become empty or 0)
      await page.waitForTimeout(300);

      // Step 4: Now set the actual value
      const setResult = await inputField.evaluate(
        (el: HTMLInputElement, val: string) => {
          try {
            el.focus();

            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value"
            )?.set;

            if (!setter) {
              return "no_setter";
            }

            // Set new value
            setter.call(el, val);

            // Dispatch all events React needs
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            el.dispatchEvent(
              new KeyboardEvent("keyup", { bubbles: true, key: "Enter" })
            );

            // Blur to trigger any onBlur handlers
            el.blur();
            el.dispatchEvent(new Event("blur", { bubbles: true }));

            return "ok";
          } catch (e) {
            return "setter_error: " + String(e);
          }
        },
        value.toString()
      );

      if (setResult !== "ok") {
        return setResult;
      }

      // Step 5: Verify the value was set correctly
      await page.waitForTimeout(150);
      const currentValue = await inputField.evaluate(
        (el: HTMLInputElement) => el.value
      );
      const expectedStr = value.toString();

      if (
        currentValue !== expectedStr &&
        currentValue.replace(/,/g, "") !== expectedStr
      ) {
        return `value_mismatch: expected ${expectedStr}, got ${currentValue}`;
      }

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
