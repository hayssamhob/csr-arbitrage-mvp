import puppeteer, { Browser, Page } from "puppeteer";
import { ScraperConfig } from "./config";
import { LogFn, QuoteData, ScrapeError, TokenSymbol } from "./types";

/**
 * Robust Uniswap UI Scraper
 *
 * Uses text anchors and semantic selectors instead of brittle CSS classes.
 * Implements stable output detection with debouncing.
 * Self-healing: restarts browser on consecutive failures.
 */
export class UniswapScraper {
  private browser: Browser | null = null;
  private pages: Map<TokenSymbol, Page> = new Map();
  private config: ScraperConfig;
  private onLog: LogFn;
  private consecutiveFailures: Map<TokenSymbol, number> = new Map();
  private recentErrors: ScrapeError[] = [];
  private lastSuccessTs: number | null = null;

  constructor(config: ScraperConfig, onLog: LogFn) {
    this.config = config;
    this.onLog = onLog;
    this.consecutiveFailures.set("CSR", 0);
    this.consecutiveFailures.set("CSR25", 0);
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

    // Initialize pages for each token
    for (const token of ["CSR", "CSR25"] as TokenSymbol[]) {
      await this.initializePage(token);
    }

    this.onLog("info", "browser_initialized", {
      pages: Array.from(this.pages.keys()),
    });
  }

  private async initializePage(token: TokenSymbol): Promise<void> {
    if (!this.browser) throw new Error("Browser not initialized");

    const page = await this.browser.newPage();

    // Set user agent
    await page.setUserAgent(this.config.userAgent);

    // Block unnecessary resources to speed up loading
    if (this.config.blockResources) {
      await page.setRequestInterception(true);
      page.on("request", (req) => {
        const resourceType = req.resourceType();
        if (["image", "font", "media", "stylesheet"].includes(resourceType)) {
          req.abort();
        } else {
          req.continue();
        }
      });
    }

    // Navigate to Uniswap swap page
    const url = this.config.tokens[token];
    this.onLog("info", "page_navigating", { token, url });

    try {
      await page.goto(url, {
        waitUntil: "networkidle2",
        timeout: this.config.uniswapTimeoutMs,
      });

      // Handle consent modals
      if (this.config.consentAutoAccept) {
        await this.handleConsentModals(page);
      }

      this.pages.set(token, page);
      this.onLog("info", "page_loaded", { token });
    } catch (error) {
      this.onLog("error", "page_load_failed", {
        token,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async handleConsentModals(page: Page): Promise<void> {
    try {
      // Wait briefly for any modal to appear
      await page.waitForTimeout(1000);

      // Try multiple selectors for consent/cookie buttons
      const consentSelectors = [
        'button:has-text("Accept")',
        'button:has-text("I understand")',
        'button:has-text("Got it")',
        '[data-testid="web3-status-connected"]',
        'button[aria-label="Close"]',
      ];

      for (const selector of consentSelectors) {
        try {
          const element = await page.$(selector);
          if (element) {
            await element.click();
            this.onLog("debug", "consent_clicked", { selector });
            await page.waitForTimeout(500);
          }
        } catch {
          // Ignore - selector might not exist
        }
      }
    } catch {
      // Consent handling is best-effort
    }
  }

  /**
   * Scrape quote for a specific token and amount
   * Uses robust selectors based on text anchors
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
        "Page not initialized"
      );
    }

    const startTime = Date.now();

    try {
      // Find and clear the input field using multiple strategies
      const inputValue = await this.setInputAmount(page, amountUsdt);
      if (!inputValue) {
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "selector_missing",
          "Could not find input field"
        );
      }

      // Wait for quote to stabilize (same value 2-3 times over 500ms)
      const outputAmount = await this.waitForStableOutput(page);
      if (outputAmount === null) {
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "timeout",
          "Output did not stabilize"
        );
      }

      if (outputAmount <= 0) {
        return this.createInvalidQuote(
          token,
          amountUsdt,
          "ui_changed",
          "Invalid output amount"
        );
      }

      // Extract gas estimate
      const gasEstimate = await this.extractGasEstimate(page);

      // Extract route info
      const route = await this.extractRoute(page);

      // Calculate effective price
      const effectivePrice = amountUsdt / outputAmount;

      // Success - reset failure counter
      this.consecutiveFailures.set(token, 0);
      this.lastSuccessTs = Date.now();

      this.onLog("info", "quote_scraped", {
        token,
        amountUsdt,
        outputAmount,
        effectivePrice,
        gasEstimate,
        durationMs: Date.now() - startTime,
      });

      return {
        market: `${token}_USDT`,
        inputToken: "USDT",
        outputToken: token,
        amountInUSDT: amountUsdt,
        amountOutToken: outputAmount.toFixed(8),
        effectivePriceUsdtPerToken: effectivePrice,
        gasEstimateUsdt: gasEstimate,
        route,
        ts: Math.floor(Date.now() / 1000),
        valid: true,
      };
    } catch (error) {
      const failures = (this.consecutiveFailures.get(token) || 0) + 1;
      this.consecutiveFailures.set(token, failures);

      const scrapeError: ScrapeError = {
        type: "unknown",
        message: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      };
      this.recentErrors.push(scrapeError);
      // Keep only last 5 minutes of errors
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      this.recentErrors = this.recentErrors.filter(
        (e) => e.timestamp > fiveMinAgo
      );

      this.onLog("error", "scrape_failed", {
        token,
        amountUsdt,
        error: scrapeError.message,
        consecutiveFailures: failures,
      });

      // Check if browser restart is needed
      if (failures >= this.config.browserRestartOnFailures) {
        this.onLog("warn", "browser_restart_triggered", { token, failures });
        await this.restartBrowser();
      }

      return this.createInvalidQuote(
        token,
        amountUsdt,
        scrapeError.type,
        scrapeError.message
      );
    }
  }

  /**
   * Set the input amount using robust selectors
   */
  private async setInputAmount(page: Page, amount: number): Promise<boolean> {
    // Strategy 1: Find input by inputmode="decimal"
    // Strategy 2: Find input near "You pay" text
    // Strategy 3: Find first numeric input in swap panel

    const inputStrategies = [
      // By inputmode attribute
      'input[inputmode="decimal"]',
      // By data-testid
      'input[data-testid="token-amount-input"]',
      '[data-testid="amount-input"] input',
      // By aria-label patterns
      'input[aria-label*="amount"]',
      'input[aria-label*="pay"]',
      // Generic fallback - first input in swap container
      '[class*="swap"] input[type="text"]',
      'input[type="text"]',
    ];

    for (const selector of inputStrategies) {
      try {
        const input = await page.$(selector);
        if (input) {
          // Clear existing value
          await input.click({ clickCount: 3 });
          await page.keyboard.press("Backspace");

          // Type new amount
          await input.type(amount.toString(), { delay: 50 });

          this.onLog("debug", "input_set", { selector, amount });
          return true;
        }
      } catch {
        continue;
      }
    }

    // Try XPath as fallback - find by nearby text
    try {
      const xpathExpressions = [
        '//text()[contains(., "You pay")]/ancestor::div[1]//input',
        '//input[@inputmode="decimal"][1]',
      ];

      for (const xpath of xpathExpressions) {
        const elements = await page.$x(xpath);
        if (elements.length > 0) {
          const input = elements[0] as any;
          await input.click({ clickCount: 3 });
          await page.keyboard.press("Backspace");
          await input.type(amount.toString(), { delay: 50 });
          this.onLog("debug", "input_set_xpath", { xpath, amount });
          return true;
        }
      }
    } catch {
      // XPath failed
    }

    return false;
  }

  /**
   * Wait for output to stabilize (same value observed 2-3 times)
   */
  private async waitForStableOutput(page: Page): Promise<number | null> {
    const maxAttempts = 10;
    const checkInterval = 200; // ms
    const requiredConsecutive = 3;

    let lastValue: number | null = null;
    let consecutiveSame = 0;

    for (let i = 0; i < maxAttempts; i++) {
      await page.waitForTimeout(checkInterval);

      const currentValue = await this.extractOutputAmount(page);

      if (currentValue !== null && currentValue > 0) {
        if (currentValue === lastValue) {
          consecutiveSame++;
          if (consecutiveSame >= requiredConsecutive) {
            return currentValue;
          }
        } else {
          consecutiveSame = 1;
          lastValue = currentValue;
        }
      }
    }

    // Return last valid value even if not fully stable
    return lastValue;
  }

  /**
   * Extract output amount using robust selectors
   */
  private async extractOutputAmount(page: Page): Promise<number | null> {
    const outputStrategies = [
      // Multiple input fields - second one is usually output
      async () => {
        const inputs = await page.$$('input[inputmode="decimal"]');
        if (inputs.length >= 2) {
          const value = await inputs[1].evaluate(
            (el) => (el as HTMLInputElement).value
          );
          return this.parseNumericValue(value);
        }
        return null;
      },
      // By data-testid
      async () => {
        const el = await page.$(
          '[data-testid="amount-output"] input, [data-testid="token-amount-output"]'
        );
        if (el) {
          const value = await el.evaluate(
            (el) => (el as HTMLInputElement).value || el.textContent
          );
          return this.parseNumericValue(value);
        }
        return null;
      },
      // By position - second swap panel
      async () => {
        return await page.evaluate(() => {
          const inputs = document.querySelectorAll(
            'input[inputmode="decimal"]'
          );
          if (inputs.length >= 2) {
            const value = (inputs[1] as HTMLInputElement).value;
            return value ? parseFloat(value.replace(/,/g, "")) : null;
          }
          return null;
        });
      },
      // By nearby text "You receive"
      async () => {
        return await page.evaluate(() => {
          const receiveText = Array.from(document.querySelectorAll("*")).find(
            (el) => el.textContent?.includes("You receive")
          );
          if (receiveText) {
            const container = receiveText.closest("div");
            const input = container?.querySelector("input");
            if (input) {
              return parseFloat(input.value.replace(/,/g, "")) || null;
            }
          }
          return null;
        });
      },
    ];

    for (const strategy of outputStrategies) {
      try {
        const result = await strategy();
        if (result !== null && result > 0 && isFinite(result)) {
          return result;
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  /**
   * Extract gas estimate from UI
   */
  private async extractGasEstimate(page: Page): Promise<number> {
    try {
      return await page.evaluate(() => {
        // Look for text containing "$" and common gas-related terms
        const gasPatterns = [
          /Network cost[:\s]*\$?([\d.]+)/i,
          /Gas[:\s]*\$?([\d.]+)/i,
          /Fee[:\s]*\$?([\d.]+)/i,
          /≈\s*\$?([\d.]+)/,
        ];

        const allText = document.body.innerText;

        for (const pattern of gasPatterns) {
          const match = allText.match(pattern);
          if (match) {
            const value = parseFloat(match[1]);
            if (value > 0 && value < 100) {
              // Sanity check
              return value;
            }
          }
        }

        // Fallback: look for elements with gas-related classes or aria labels
        const gasElements = Array.from(
          document.querySelectorAll(
            '[class*="gas"], [class*="fee"], [aria-label*="gas"]'
          )
        );
        for (const el of gasElements) {
          const text = el.textContent || "";
          const match = text.match(/\$?([\d.]+)/);
          if (match) {
            const value = parseFloat(match[1]);
            if (value > 0 && value < 100) {
              return value;
            }
          }
        }

        return 0; // Unable to extract
      });
    } catch {
      return 0;
    }
  }

  /**
   * Extract route information
   */
  private async extractRoute(page: Page): Promise<string> {
    try {
      return await page.evaluate(() => {
        // Look for route/path display
        const routeElements = Array.from(
          document.querySelectorAll('[class*="route"], [class*="path"]')
        );
        for (const el of routeElements) {
          const text = el.textContent?.trim();
          if (text && text.includes("→")) {
            return text;
          }
        }
        return "USDT → TOKEN";
      });
    } catch {
      return "USDT → TOKEN";
    }
  }

  private parseNumericValue(value: string | null): number | null {
    if (!value) return null;
    const cleaned = value.replace(/,/g, "").trim();
    if (cleaned === "" || cleaned === "—" || cleaned === "-") return null;
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  private createInvalidQuote(
    token: TokenSymbol,
    amountUsdt: number,
    reason: ScrapeError["type"],
    message: string
  ): QuoteData {
    return {
      market: `${token}_USDT`,
      inputToken: "USDT",
      outputToken: token,
      amountInUSDT: amountUsdt,
      amountOutToken: "0",
      effectivePriceUsdtPerToken: 0,
      gasEstimateUsdt: 0,
      route: "none",
      ts: Math.floor(Date.now() / 1000),
      valid: false,
      reason: `${reason}: ${message}`,
    };
  }

  async restartBrowser(): Promise<void> {
    this.onLog("warn", "browser_restarting");

    try {
      await this.close();
    } catch {
      // Ignore close errors
    }

    // Wait before restart
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await this.initialize();

    // Reset failure counters
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
