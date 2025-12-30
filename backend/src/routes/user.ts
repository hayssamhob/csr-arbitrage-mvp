/**
 * User API Routes
 * 
 * All routes require authentication and are scoped to the authenticated user.
 * Handles risk limits, wallets, and exchange credentials.
 */

import { createClient } from '@supabase/supabase-js';
import axios from "axios";
import * as crypto from "crypto";
import { Router } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

// Token contract addresses on Ethereum mainnet
const TOKEN_CONTRACTS = {
  CSR: "0x6bba316c48b49bd1eac44573c5c871ff02958469",
  CSR25: "0x0f5c78f152152dda52a2ea45b0a8c10733010748",
  USDT: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  USDC: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  WETH: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
};

// ERC20 ABI for balance checking
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const router = Router();

// Lazy initialization for Supabase client (env vars loaded after module import)
// Using 'any' to avoid strict type checking on untyped database schema
let _supabase: any = null;

function getSupabase(): any {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.warn("Supabase credentials not configured for user routes");
    return null;
  }

  _supabase = createClient(supabaseUrl, supabaseServiceKey);
  return _supabase;
}

// Lazy getter for encryption key
function getCexSecretsKey(): string | undefined {
  return process.env.CEX_SECRETS_KEY;
}

// Encryption helpers using AES-256-GCM
function encrypt(text: string): string {
  const key = getCexSecretsKey();
  if (!key) throw new Error("CEX_SECRETS_KEY not configured");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    iv
  );

  let encrypted = cipher.update(text, "utf8", "base64");
  encrypted += cipher.final("base64");
  const tag = cipher.getAuthTag();

  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted}`;
}

function decrypt(encryptedData: string): string {
  const key = getCexSecretsKey();
  if (!key) throw new Error("CEX_SECRETS_KEY not configured");

  const [ivB64, tagB64, ciphertext] = encryptedData.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    iv
  );
  decipher.setAuthTag(tag);

  let decrypted = decipher.update(ciphertext, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

// GET /api/me/risk-limits
router.get(
  "/risk-limits",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { data, error } = await supabase
      .from("risk_limits")
      .select("*")
      .eq("user_id", req.userId)
      .single();

    if (error && error.code !== "PGRST116") {
      return res.status(500).json({ error: error.message });
    }

    // Return defaults if no record exists
    res.json(
      data || {
        max_order_usdt: 1000,
        daily_limit_usdt: 10000,
        min_edge_bps: 50,
        max_slippage_bps: 100,
        kill_switch: true,
      }
    );
  }
);

// PUT /api/me/risk-limits
router.put(
  "/risk-limits",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const {
      max_order_usdt,
      daily_limit_usdt,
      min_edge_bps,
      max_slippage_bps,
      kill_switch,
    } = req.body;

    const { data, error } = await supabase
      .from("risk_limits")
      .upsert({
        user_id: req.userId,
        max_order_usdt,
        daily_limit_usdt,
        min_edge_bps,
        max_slippage_bps,
        kill_switch,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Log the change
    await supabase.from("audit_log").insert({
      user_id: req.userId,
      action: "risk_limits_updated",
      metadata: { changes: req.body },
    });

    res.json(data);
  }
);

// GET /api/me/wallets
router.get("/wallets", requireAuth, async (req: AuthenticatedRequest, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Database not configured" });
  }

  const { data, error } = await supabase
    .from("wallets")
    .select("id, chain, address, label, created_at")
    .eq("user_id", req.userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data || []);
});

// POST /api/me/wallets
router.post("/wallets", requireAuth, async (req: AuthenticatedRequest, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Database not configured" });
  }

  const { chain, address, label } = req.body;

  if (!address) {
    return res.status(400).json({ error: "Address is required" });
  }

  const { data, error } = await supabase
    .from("wallets")
    .insert({
      user_id: req.userId,
      chain: chain || "ethereum",
      address,
      label,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Log the change
  await supabase.from("audit_log").insert({
    user_id: req.userId,
    action: "wallet_added",
    metadata: { chain, address: address.slice(0, 10) + "..." },
  });

  res.json(data);
});

// DELETE /api/me/wallets/:id
router.delete(
  "/wallets/:id",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { error } = await supabase
      .from("wallets")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ success: true });
  }
);

// Helper to mask API key (show first 4 and last 4 chars)
function maskApiKey(encryptedKey: string): string {
  try {
    const key = decrypt(encryptedKey);
    if (key.length <= 8) return '****';
    return key.slice(0, 4) + '****' + key.slice(-4);
  } catch {
    return '****';
  }
}

// Helper to mask secret (show only last 4 chars)
function maskSecret(encryptedSecret: string): string {
  try {
    const secret = decrypt(encryptedSecret);
    if (secret.length <= 4) return '****';
    return '****' + secret.slice(-4);
  } catch {
    return '****';
  }
}

// GET /api/me/exchanges - Returns status and masked keys
router.get(
  "/exchanges",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const { data, error } = await supabase
      .from("exchange_credentials")
      .select(
        "id, venue, api_key_enc, api_secret_enc, last_test_ok, last_test_error, last_test_at, created_at, updated_at"
      )
      .eq("user_id", req.userId);

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Transform to status format with masked keys
    const exchanges = (data || []).map((cred: any) => ({
      venue: cred.venue,
      connected: true,
      api_key_masked: cred.api_key_enc ? maskApiKey(cred.api_key_enc) : null,
      api_secret_masked: cred.api_secret_enc
        ? maskSecret(cred.api_secret_enc)
        : null,
      has_secret: !!cred.api_secret_enc,
      last_test_ok: cred.last_test_ok,
      last_test_error: cred.last_test_error,
      last_test_at: cred.last_test_at,
      created_at: cred.created_at,
    }));

    res.json(exchanges);
  }
);

// POST /api/me/exchanges/:venue - Save/update encrypted credentials
router.post(
  "/exchanges/:venue",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const venue = req.params.venue.toLowerCase();
    if (!["lbank", "latoken"].includes(venue)) {
      return res
        .status(400)
        .json({ error: "Invalid venue. Use lbank or latoken" });
    }

    const { api_key, api_secret, api_passphrase } = req.body;

    // LBank only requires API key, LATOKEN requires both
    if (!api_key) {
      return res.status(400).json({ error: "api_key is required" });
    }

    if (venue === "latoken" && !api_secret) {
      return res
        .status(400)
        .json({ error: "api_secret is required for LATOKEN" });
    }

    if (!getCexSecretsKey()) {
      return res.status(503).json({ error: "Encryption not configured" });
    }

    try {
      const encryptedKey = encrypt(api_key);
      const encryptedSecret = api_secret ? encrypt(api_secret) : null;
      const encryptedPassphrase = api_passphrase
        ? encrypt(api_passphrase)
        : null;

      const { data, error } = await supabase
        .from("exchange_credentials")
        .upsert(
          {
            user_id: req.userId,
            venue,
            api_key_enc: encryptedKey,
            api_secret_enc: encryptedSecret,
            api_passphrase_enc: encryptedPassphrase,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,venue",
          }
        )
        .select("id, venue, created_at, updated_at")
        .single();

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      // Log the change (no secrets)
      await supabase.from("audit_log").insert({
        user_id: req.userId,
        action: "exchange_credentials_updated",
        metadata: { venue },
      });

      res.json({ success: true, venue, updated_at: data.updated_at });
    } catch (err: any) {
      console.error("Encryption error:", err.message);
      return res.status(500).json({ error: "Failed to encrypt credentials" });
    }
  }
);

// POST /api/me/exchanges/:venue/test - Test API keys
router.post(
  "/exchanges/:venue/test",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const supabase = getSupabase();
    if (!supabase) {
      return res.status(503).json({ error: "Database not configured" });
    }

    const venue = req.params.venue.toLowerCase();
    if (!["lbank", "latoken"].includes(venue)) {
      return res.status(400).json({ error: "Invalid venue" });
    }

    // Get encrypted credentials
    const { data: creds, error } = await supabase
      .from("exchange_credentials")
      .select("api_key_enc, api_secret_enc, api_passphrase_enc")
      .eq("user_id", req.userId)
      .eq("venue", venue)
      .single();

    if (error || !creds) {
      return res
        .status(404)
        .json({ error: "Credentials not found for this venue" });
    }

    try {
      const apiKey = decrypt(creds.api_key_enc);
      const apiSecret = creds.api_secret_enc
        ? decrypt(creds.api_secret_enc)
        : null;

      // TODO: Implement actual API test calls for each venue
      // For now, just verify decryption works
      const testResult = {
        success: true,
        message: apiSecret
          ? "Credentials decrypted successfully. API test not yet implemented."
          : "API key decrypted successfully (no secret configured).",
      };

      // Update test result in DB
      await supabase
        .from("exchange_credentials")
        .update({
          last_test_ok: testResult.success,
          last_test_error: testResult.success ? null : testResult.message,
          last_test_at: new Date().toISOString(),
        })
        .eq("user_id", req.userId)
        .eq("venue", venue);

      // Log the test
      await supabase.from("audit_log").insert({
        user_id: req.userId,
        action: "exchange_credentials_tested",
        metadata: { venue, success: testResult.success },
      });

      res.json(testResult);
    } catch (err: any) {
      console.error("Decryption/test error:", err.message);

      await supabase
        .from("exchange_credentials")
        .update({
          last_test_ok: false,
          last_test_error: "Decryption failed",
          last_test_at: new Date().toISOString(),
        })
        .eq("user_id", req.userId)
        .eq("venue", venue);

      return res.status(500).json({ error: "Failed to test credentials" });
    }
  }
);

// GET /api/me/balances - Fetch balances from all connected exchanges
router.get("/balances", requireAuth, async (req: AuthenticatedRequest, res) => {
  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Database not configured" });
  }

  // Get all exchange credentials for user
  const { data: credentials, error } = await supabase
    .from("exchange_credentials")
    .select("venue, api_key_enc, api_secret_enc")
    .eq("user_id", req.userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const balances: any[] = [];
  const exchangeStatuses: any = {};

  // Process each exchange - mark as connected if credentials exist
  for (const cred of credentials || []) {
    // Mark exchange as connected (credentials exist)
    exchangeStatuses[cred.venue] = { connected: true, error: null };

    try {
      const apiKey = decrypt(cred.api_key_enc);
      const apiSecret = cred.api_secret_enc
        ? decrypt(cred.api_secret_enc)
        : null;

      if (cred.venue === "latoken" && apiKey && apiSecret) {
        // Fetch LATOKEN balances using their API
        try {
          const latokenBalances = await fetchLatokenBalances(apiKey, apiSecret);
          balances.push(...latokenBalances);
        } catch (balanceErr: any) {
          // Still connected, just balance fetch failed
          exchangeStatuses.latoken = {
            connected: true,
            error: `Balance fetch: ${balanceErr.message?.substring(0, 50)}...`,
          };
        }
      } else if (cred.venue === "lbank" && apiKey) {
        // LBank - try to fetch balances if we have a secret
        if (apiSecret) {
          try {
            const lbankBalances = await fetchLbankBalances(apiKey, apiSecret);
            balances.push(...lbankBalances);
            exchangeStatuses.lbank = { connected: true, error: null };
          } catch (balanceErr: any) {
            exchangeStatuses.lbank = {
              connected: true,
              error: `Balance fetch: ${balanceErr.message?.substring(
                0,
                50
              )}...`,
            };
          }
        } else {
          // No secret - can only do read-only operations
          exchangeStatuses.lbank = {
            connected: true,
            error: "API secret required for balance fetch",
          };
        }
      }
    } catch (err: any) {
      console.error(`Error processing ${cred.venue}:`, err.message);
      // Still mark as connected since credentials exist
      exchangeStatuses[cred.venue] = { connected: true, error: err.message };
    }
  }

  // Get risk limits
  const { data: limits } = await supabase
    .from("risk_limits")
    .select("*")
    .eq("user_id", req.userId)
    .single();

  // Get saved wallet address
  const { data: wallets } = await supabase
    .from("wallets")
    .select("address")
    .eq("user_id", req.userId)
    .limit(1);

  const savedWalletAddress = wallets?.[0]?.address || null;

  // Fetch wallet balances if we have a saved address
  if (savedWalletAddress) {
    try {
      const walletBalances = await fetchWalletBalances(savedWalletAddress);
      balances.push(...walletBalances);
      exchangeStatuses.wallet = { connected: true, error: null };
    } catch (walletErr: any) {
      console.error("Wallet balance fetch error:", walletErr.message);
      exchangeStatuses.wallet = { connected: true, error: walletErr.message };
    }
  }

  // Fetch current prices and calculate USD values
  const prices = await fetchCurrentPrices();
  const balancesWithUsd = calculateUsdValues(balances, prices);
  const totalUsd = balancesWithUsd.reduce(
    (sum, b) => sum + (b.usd_value || 0),
    0
  );

  res.json({
    balances: balancesWithUsd,
    total_usd: totalUsd,
    exchange_statuses: exchangeStatuses,
    exposure: {
      max_per_trade_usd: limits?.max_order_usdt || 1000,
      max_daily_usd: limits?.daily_limit_usdt || 10000,
      used_daily_usd: 0, // TODO: Track from trade history
    },
    last_update: new Date().toISOString(),
    saved_wallet_address: savedWalletAddress,
    prices: prices,
  });
});

// Helper to fetch LATOKEN balances using CCXT
async function fetchLatokenBalances(
  apiKey: string,
  apiSecret: string
): Promise<any[]> {
  const ccxt = require("ccxt");

  try {
    const exchange = new ccxt.latoken({
      apiKey: apiKey,
      secret: apiSecret,
      enableRateLimit: true,
    });

    const balance = await exchange.fetchBalance();

    // Transform CCXT balance response to our format
    const balances: any[] = [];

    for (const [currency, data] of Object.entries(balance.total || {})) {
      const total = data as number;
      if (total > 0) {
        const free = (balance.free?.[currency] as number) || 0;
        const used = (balance.used?.[currency] as number) || 0;
        balances.push({
          venue: "LATOKEN",
          asset: currency.toUpperCase(),
          available: free,
          locked: used,
          total: total,
          usd_value: 0, // Would need price data to calculate
        });
      }
    }

    return balances;
  } catch (error: any) {
    console.error("LATOKEN balance fetch error:", error.message);
    throw new Error(`LATOKEN: ${error.message}`);
  }
}

// Helper to fetch LBank balances using CCXT
async function fetchLbankBalances(
  apiKey: string,
  apiSecret: string
): Promise<any[]> {
  const ccxt = require("ccxt");

  try {
    const exchange = new ccxt.lbank({
      apiKey: apiKey,
      secret: apiSecret,
      enableRateLimit: true,
    });

    const balance = await exchange.fetchBalance();

    // Transform CCXT balance response to our format
    const balances: any[] = [];

    for (const [currency, data] of Object.entries(balance.total || {})) {
      const total = data as number;
      if (total > 0) {
        const free = (balance.free?.[currency] as number) || 0;
        const used = (balance.used?.[currency] as number) || 0;
        balances.push({
          venue: "LBank",
          asset: currency.toUpperCase(),
          available: free,
          locked: used,
          total: total,
          usd_value: 0,
        });
      }
    }

    return balances;
  } catch (error: any) {
    console.error("LBank balance fetch error:", error.message);
    throw new Error(`LBank: ${error.message}`);
  }
}

// Helper to fetch wallet balances from Ethereum blockchain
async function fetchWalletBalances(walletAddress: string): Promise<any[]> {
  const ethers = require("ethers");
  const balances: any[] = [];

  try {
    // Use public RPC endpoint
    const rpcUrl = process.env.RPC_URL || "https://eth.llamarpc.com";
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Fetch ETH balance
    const ethBalance = await provider.getBalance(walletAddress);
    const ethBalanceFormatted = parseFloat(ethers.formatEther(ethBalance));

    if (ethBalanceFormatted > 0) {
      balances.push({
        venue: "Wallet",
        asset: "ETH",
        available: ethBalanceFormatted,
        locked: 0,
        total: ethBalanceFormatted,
        usd_value: 0,
        contract_address: null,
      });
    }

    // Fetch token balances for CSR and CSR25
    const tokensToCheck = [
      { symbol: "CSR", address: TOKEN_CONTRACTS.CSR, decimals: 18 },
      { symbol: "CSR25", address: TOKEN_CONTRACTS.CSR25, decimals: 18 },
      { symbol: "USDT", address: TOKEN_CONTRACTS.USDT, decimals: 6 },
      { symbol: "USDC", address: TOKEN_CONTRACTS.USDC, decimals: 6 },
    ];

    for (const token of tokensToCheck) {
      try {
        const contract = new ethers.Contract(
          token.address,
          ERC20_ABI,
          provider
        );
        const balance = await contract.balanceOf(walletAddress);
        const formattedBalance = parseFloat(
          ethers.formatUnits(balance, token.decimals)
        );

        if (formattedBalance > 0) {
          balances.push({
            venue: "Wallet",
            asset: token.symbol,
            available: formattedBalance,
            locked: 0,
            total: formattedBalance,
            usd_value: 0,
            contract_address: token.address,
          });
        }
      } catch (tokenErr: any) {
        console.warn(
          `Failed to fetch ${token.symbol} balance:`,
          tokenErr.message
        );
      }
    }

    return balances;
  } catch (error: any) {
    console.error("Wallet balance fetch error:", error.message);
    return balances;
  }
}

// Helper to fetch current prices for USD value calculation
async function fetchCurrentPrices(): Promise<Record<string, number>> {
  const prices: Record<string, number> = {
    ETH: 0,
    USDT: 1,
    USDC: 1,
    CSR: 0,
    CSR25: 0,
  };

  try {
    // Try CoinGecko first, fallback to hardcoded recent price
    const ethResponse = await axios.get(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { timeout: 3000 }
    );
    prices.ETH = ethResponse.data?.ethereum?.usd || 3400; // Fallback to recent price
  } catch (err) {
    // Use approximate current ETH price as fallback
    prices.ETH = 3400;
  }

  // Fetch CSR/CSR25 prices from our own dashboard API
  try {
    const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:8001";
    const response = await axios.get(`${dashboardUrl}/api/dashboard`, {
      timeout: 5000,
    });
    const data = response.data;

    // Get CSR price from LATOKEN
    if (data?.market_state?.csr_usdt?.latoken_ticker?.last) {
      prices.CSR = data.market_state.csr_usdt.latoken_ticker.last;
    }

    // Get CSR25 price from LBank
    if (data?.market_state?.csr25_usdt?.lbank_ticker?.last) {
      prices.CSR25 = data.market_state.csr25_usdt.lbank_ticker.last;
    }
  } catch (err) {
    console.warn("Failed to fetch CSR/CSR25 prices from dashboard");
  }

  return prices;
}

// Helper to calculate USD values for balances
function calculateUsdValues(
  balances: any[],
  prices: Record<string, number>
): any[] {
  return balances.map((balance) => ({
    ...balance,
    usd_value: (balance.total || 0) * (prices[balance.asset] || 0),
  }));
}

// Uniswap V3 Position Manager contract address
const UNISWAP_V3_POSITIONS_NFT = "0xC36442b4a4522E871399CD717aBDD847Ab11FE88";

// Uniswap V4 Position Manager contract address (mainnet)
const UNISWAP_V4_POSITION_MANAGER = "0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e";

// Uniswap V4 Position Manager ABI
const V4_POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positionInfo(uint256 tokenId) view returns (bytes25 poolId, int24 tickLower, int24 tickUpper, uint128 liquidity)",
  "function poolKeys(bytes25 poolId) view returns (address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
];

// Uniswap V2 pair contracts for CSR tokens
const UNISWAP_V2_PAIRS: Record<
  string,
  { token0: string; token1: string; name: string }
> = {
  // CSR/WETH pair on Uniswap V2 (if exists)
  "0x0000000000000000000000000000000000000000": {
    token0: "CSR",
    token1: "WETH",
    name: "CSR/WETH",
  },
};

// V2 LP Token ABI (just balanceOf and totalSupply for now)
const V2_LP_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
];

// ABI for Uniswap V3 NonfungiblePositionManager
const POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function positions(uint256 tokenId) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
];

// Token symbol mapping
const TOKEN_SYMBOLS: Record<string, { symbol: string; decimals: number }> = {
  "0x6bba316c48b49bd1eac44573c5c871ff02958469": { symbol: "CSR", decimals: 18 },
  "0x0f5c78f152152dda52a2ea45b0a8c10733010748": {
    symbol: "CSR25",
    decimals: 18,
  },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    symbol: "WETH",
    decimals: 18,
  },
};

// Helper to fetch Uniswap V3 liquidity positions for a wallet
async function fetchUniswapV3Positions(walletAddress: string): Promise<any[]> {
  const ethers = require("ethers");
  const positions: any[] = [];

  try {
    const rpcUrl = process.env.RPC_URL || "https://eth.llamarpc.com";
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const positionManager = new ethers.Contract(
      UNISWAP_V3_POSITIONS_NFT,
      POSITION_MANAGER_ABI,
      provider
    );

    // Get number of positions owned by wallet
    const balance = await positionManager.balanceOf(walletAddress);
    const numPositions = Number(balance);

    console.log(
      `Found ${numPositions} Uniswap V3 positions for ${walletAddress}`
    );

    // Fetch each position
    for (let i = 0; i < Math.min(numPositions, 10); i++) {
      // Limit to 10 positions
      try {
        const tokenId = await positionManager.tokenOfOwnerByIndex(
          walletAddress,
          i
        );
        const position = await positionManager.positions(tokenId);

        const token0Address = position.token0.toLowerCase();
        const token1Address = position.token1.toLowerCase();
        const token0Info = TOKEN_SYMBOLS[token0Address] || {
          symbol: token0Address.slice(0, 8),
          decimals: 18,
        };
        const token1Info = TOKEN_SYMBOLS[token1Address] || {
          symbol: token1Address.slice(0, 8),
          decimals: 18,
        };

        // Only include positions with liquidity > 0
        if (Number(position.liquidity) > 0) {
          positions.push({
            tokenId: tokenId.toString(),
            token0: {
              address: position.token0,
              symbol: token0Info.symbol,
              decimals: token0Info.decimals,
            },
            token1: {
              address: position.token1,
              symbol: token1Info.symbol,
              decimals: token1Info.decimals,
            },
            fee: Number(position.fee),
            liquidity: position.liquidity.toString(),
            tickLower: Number(position.tickLower),
            tickUpper: Number(position.tickUpper),
            tokensOwed0: ethers.formatUnits(
              position.tokensOwed0,
              token0Info.decimals
            ),
            tokensOwed1: ethers.formatUnits(
              position.tokensOwed1,
              token1Info.decimals
            ),
          });
        }
      } catch (posErr: any) {
        console.warn(`Error fetching position ${i}:`, posErr.message);
      }
    }

    return positions;
  } catch (error: any) {
    console.error("Uniswap V3 positions fetch error:", error.message);
    return positions;
  }
}

// Helper to fetch Uniswap V4 liquidity positions for a wallet
async function fetchUniswapV4Positions(walletAddress: string): Promise<any[]> {
  const ethers = require("ethers");
  const positions: any[] = [];

  try {
    const rpcUrl = process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";
    const provider = new ethers.JsonRpcProvider(rpcUrl);

    const positionManager = new ethers.Contract(
      UNISWAP_V4_POSITION_MANAGER,
      V4_POSITION_MANAGER_ABI,
      provider
    );

    // Get number of V4 positions owned by wallet
    const balance = await positionManager.balanceOf(walletAddress);
    const numPositions = Number(balance);

    console.log(`Found ${numPositions} Uniswap V4 positions for ${walletAddress}`);

    // Fetch each position
    for (let i = 0; i < Math.min(numPositions, 10); i++) {
      try {
        const tokenId = await positionManager.tokenOfOwnerByIndex(walletAddress, i);
        const posInfo = await positionManager.positionInfo(tokenId);
        
        // Get pool keys for this position
        const poolKey = await positionManager.poolKeys(posInfo.poolId);
        
        const token0Address = poolKey.currency0.toLowerCase();
        const token1Address = poolKey.currency1.toLowerCase();
        const token0Info = TOKEN_SYMBOLS[token0Address] || { symbol: token0Address.slice(0, 8), decimals: 18 };
        const token1Info = TOKEN_SYMBOLS[token1Address] || { symbol: token1Address.slice(0, 8), decimals: 18 };

        // Only include positions with liquidity > 0
        if (Number(posInfo.liquidity) > 0) {
          positions.push({
            version: "V4",
            tokenId: tokenId.toString(),
            poolId: posInfo.poolId,
            token0: {
              address: poolKey.currency0,
              symbol: token0Info.symbol,
              decimals: token0Info.decimals,
            },
            token1: {
              address: poolKey.currency1,
              symbol: token1Info.symbol,
              decimals: token1Info.decimals,
            },
            fee: Number(poolKey.fee),
            liquidity: posInfo.liquidity.toString(),
            tickLower: Number(posInfo.tickLower),
            tickUpper: Number(posInfo.tickUpper),
            hooks: poolKey.hooks,
            tokensOwed0: "0", // V4 requires different method to get owed tokens
            tokensOwed1: "0",
          });
        }
      } catch (posErr: any) {
        console.warn(`Error fetching V4 position ${i}:`, posErr.message);
      }
    }

    return positions;
  } catch (error: any) {
    console.error("Uniswap V4 positions fetch error:", error.message);
    return positions;
  }
}

// Endpoint to fetch liquidity pool positions
router.get(
  "/me/liquidity-positions",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      // Get all wallets for the user
      const { data: wallets } = await supabase
        .from("wallets")
        .select("id, address, label")
        .eq("user_id", req.userId);

      if (!wallets || wallets.length === 0) {
        return res.json({ positions: [], wallets: [] });
      }

      // Fetch positions for the first wallet (or specified wallet)
      const walletAddress = (req.query.wallet as string) || wallets[0]?.address;

      if (!walletAddress) {
        return res.json({ positions: [], wallets });
      }

      // Fetch V3 and V4 positions in parallel
      const [v3Positions, v4Positions] = await Promise.all([
        fetchUniswapV3Positions(walletAddress),
        fetchUniswapV4Positions(walletAddress),
      ]);

      // Combine all positions, adding version tag to V3
      const positions = [
        ...v3Positions.map((p) => ({ ...p, version: "V3" })),
        ...v4Positions,
      ];

      // Fetch current prices for USD value calculation
      const prices = await fetchCurrentPrices();

      // Calculate approximate USD values for positions
      // Note: This is a simplified calculation - real LP value requires more complex math
      const positionsWithValue = positions.map((pos) => {
        const token0Price = prices[pos.token0.symbol] || 0;
        const token1Price = prices[pos.token1.symbol] || 0;

        // Estimate value from owed tokens (claimable rewards)
        const owedValue0 = parseFloat(pos.tokensOwed0) * token0Price;
        const owedValue1 = parseFloat(pos.tokensOwed1) * token1Price;

        return {
          ...pos,
          token0_price: token0Price,
          token1_price: token1Price,
          rewards_usd: owedValue0 + owedValue1,
        };
      });

      res.json({
        positions: positionsWithValue,
        wallets: wallets.map((w: any) => ({
          id: w.id,
          address: w.address,
          label: w.label,
        })),
        selected_wallet: walletAddress,
      });
    } catch (error: any) {
      console.error("Liquidity positions error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Endpoint to add a new wallet
router.post(
  "/me/wallets",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      const { address, label } = req.body;

      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      // Check if wallet already exists for this user
      const { data: existing } = await supabase
        .from("wallets")
        .select("id")
        .eq("user_id", req.userId)
        .eq("address", address.toLowerCase())
        .single();

      if (existing) {
        return res.status(400).json({ error: "Wallet already added" });
      }

      // Insert new wallet
      const { data, error } = await supabase
        .from("wallets")
        .insert({
          user_id: req.userId,
          address: address.toLowerCase(),
          label:
            label || `Wallet ${address.slice(0, 6)}...${address.slice(-4)}`,
        })
        .select()
        .single();

      if (error) throw error;

      res.json({ wallet: data });
    } catch (error: any) {
      console.error("Add wallet error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Endpoint to get all user wallets
router.get(
  "/me/wallets",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      const { data: wallets, error } = await supabase
        .from("wallets")
        .select("id, address, label, created_at")
        .eq("user_id", req.userId)
        .order("created_at", { ascending: true });

      if (error) throw error;

      res.json({ wallets: wallets || [] });
    } catch (error: any) {
      console.error("Get wallets error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Endpoint to delete a wallet
router.delete(
  "/me/wallets/:walletId",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      const { walletId } = req.params;

      const { error } = await supabase
        .from("wallets")
        .delete()
        .eq("id", walletId)
        .eq("user_id", req.userId);

      if (error) throw error;

      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete wallet error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============================================
// REAL TRADE EXECUTION ENDPOINTS
// ============================================

// Execute a CEX trade (LATOKEN or LBank)
router.post(
  "/me/trade/cex",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const ccxt = require("ccxt");

    try {
      const { exchange, symbol, side, amount, price } = req.body;

      if (!exchange || !symbol || !side || !amount) {
        return res
          .status(400)
          .json({
            error: "Missing required fields: exchange, symbol, side, amount",
          });
      }

      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      // Get user's exchange credentials
      const { data: credentials, error: credError } = await supabase
        .from("exchange_credentials")
        .select("exchange, api_key, api_secret_encrypted")
        .eq("user_id", req.userId)
        .eq("exchange", exchange.toLowerCase())
        .single();

      if (credError || !credentials) {
        return res
          .status(400)
          .json({ error: `No API credentials found for ${exchange}` });
      }

      // Decrypt the API secret
      const encryptionKey = process.env.CEX_SECRETS_KEY;
      if (!encryptionKey) {
        return res.status(500).json({ error: "Encryption key not configured" });
      }

      const [ivHex, encryptedHex] = credentials.api_secret_encrypted.split(":");
      const iv = Buffer.from(ivHex, "hex");
      const encrypted = Buffer.from(encryptedHex, "hex");
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        Buffer.from(encryptionKey, "hex"),
        iv
      );
      let apiSecret = decipher.update(encrypted);
      apiSecret = Buffer.concat([apiSecret, decipher.final()]);
      const decryptedSecret = apiSecret.toString("utf8");

      // Create exchange instance
      let exchangeInstance;
      if (exchange.toLowerCase() === "latoken") {
        exchangeInstance = new ccxt.latoken({
          apiKey: credentials.api_key,
          secret: decryptedSecret,
          enableRateLimit: true,
        });
      } else if (exchange.toLowerCase() === "lbank") {
        exchangeInstance = new ccxt.lbank({
          apiKey: credentials.api_key,
          secret: decryptedSecret,
          enableRateLimit: true,
        });
      } else {
        return res
          .status(400)
          .json({ error: `Unsupported exchange: ${exchange}` });
      }

      // Execute the trade
      console.log(
        `Executing CEX trade: ${side} ${amount} ${symbol} on ${exchange}`
      );

      let order;
      if (price) {
        // Limit order
        order = await exchangeInstance.createLimitOrder(
          symbol,
          side,
          amount,
          price
        );
      } else {
        // Market order
        order = await exchangeInstance.createMarketOrder(symbol, side, amount);
      }

      console.log(`CEX trade executed:`, order);

      // Log the trade
      await supabase.from("trade_history").insert({
        user_id: req.userId,
        exchange: exchange,
        symbol: symbol,
        side: side,
        amount: amount,
        price: order.average || order.price || price,
        order_id: order.id,
        status: order.status,
        executed_at: new Date().toISOString(),
      });

      res.json({
        success: true,
        order: {
          id: order.id,
          symbol: order.symbol,
          side: order.side,
          amount: order.amount,
          price: order.average || order.price,
          status: order.status,
          filled: order.filled,
          remaining: order.remaining,
          cost: order.cost,
        },
      });
    } catch (error: any) {
      console.error("CEX trade execution error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Execute a DEX trade (Uniswap swap)
router.post(
  "/me/trade/dex",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    const ethers = require("ethers");

    try {
      const { tokenIn, tokenOut, amountIn, slippageBps, walletAddress } =
        req.body;

      if (!tokenIn || !tokenOut || !amountIn || !walletAddress) {
        return res
          .status(400)
          .json({
            error:
              "Missing required fields: tokenIn, tokenOut, amountIn, walletAddress",
          });
      }

      // NOTE: DEX trades require the user to sign the transaction themselves
      // This endpoint returns the transaction data for the frontend to sign

      const rpcUrl =
        process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Uniswap V3 SwapRouter address
      const SWAP_ROUTER = "0xE592427A0AEce92De3Edee1F18E0157C05861564";

      // Build swap parameters
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
      const slippage = slippageBps || 50; // 0.5% default

      // Return transaction data for frontend to sign
      // In production, you'd use Uniswap SDK to build the exact calldata
      res.json({
        success: true,
        message: "DEX trade requires wallet signature",
        transaction: {
          to: SWAP_ROUTER,
          tokenIn: tokenIn,
          tokenOut: tokenOut,
          amountIn: amountIn,
          slippageBps: slippage,
          deadline: deadline,
          // The actual swap would be executed by the frontend with user's wallet
        },
        instructions:
          "Use Uniswap interface or sign transaction with connected wallet",
      });
    } catch (error: any) {
      console.error("DEX trade preparation error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get trade history
router.get(
  "/me/trades",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      const { data: trades, error } = await supabase
        .from("trade_history")
        .select("*")
        .eq("user_id", req.userId)
        .order("executed_at", { ascending: false })
        .limit(50);

      if (error) throw error;

      res.json({ trades: trades || [] });
    } catch (error: any) {
      console.error("Get trades error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============================================
// TRANSACTION HISTORY (SERVER-SIDE ETHERSCAN)
// ============================================

// Cache for Etherscan responses (30 second TTL)
const txCache: Map<string, { data: any; timestamp: number }> = new Map();
const TX_CACHE_TTL_MS = 30000;

// Get wallet transactions via server-side Etherscan API
router.get(
  "/me/transactions",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const wallet = req.query.wallet as string;
      if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        return res.status(400).json({ error: "Invalid wallet address" });
      }

      const cacheKey = `tx:${wallet.toLowerCase()}`;
      const cached = txCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < TX_CACHE_TTL_MS) {
        return res.json({ transactions: cached.data, source: "cache", cache_age_ms: Date.now() - cached.timestamp });
      }

      const etherscanApiKey = process.env.ETHERSCAN_API_KEY;
      if (!etherscanApiKey) {
        return res.status(500).json({ error: "Etherscan API key not configured", reason: "missing_api_key" });
      }

      // Fetch ETH and ERC20 transactions in parallel with retry logic
      const fetchWithRetry = async (url: string, retries = 3): Promise<any> => {
        for (let i = 0; i < retries; i++) {
          try {
            const response = await axios.get(url, { timeout: 10000 });
            if (response.data.status === "0" && response.data.message === "NOTOK") {
              if (response.data.result?.includes("rate limit")) {
                await new Promise(r => setTimeout(r, 1000 * (i + 1)));
                continue;
              }
            }
            return response.data;
          } catch (err: any) {
            if (i === retries - 1) throw err;
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
          }
        }
      };

      const [ethData, tokenData] = await Promise.all([
        fetchWithRetry(`https://api.etherscan.io/api?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${etherscanApiKey}`),
        fetchWithRetry(`https://api.etherscan.io/api?module=account&action=tokentx&address=${wallet}&startblock=0&endblock=99999999&page=1&offset=20&sort=desc&apikey=${etherscanApiKey}`)
      ]);

      const transactions: any[] = [];

      // Process ETH transactions
      if (ethData?.status === "1" && Array.isArray(ethData.result)) {
        ethData.result.forEach((tx: any) => {
          if (parseFloat(tx.value) > 0) {
            const isSend = tx.from.toLowerCase() === wallet.toLowerCase();
            transactions.push({
              hash: tx.hash,
              kind: isSend ? "SEND" : "RECEIVE",
              asset: "ETH",
              amount: (parseFloat(tx.value) / 1e18).toFixed(6),
              timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
              status: tx.txreceipt_status === "1" ? "confirmed" : "failed",
              explorer_url: `https://etherscan.io/tx/${tx.hash}`,
              from: tx.from,
              to: tx.to,
            });
          }
        });
      }

      // Process ERC20 token transactions
      if (tokenData?.status === "1" && Array.isArray(tokenData.result)) {
        tokenData.result.forEach((tx: any) => {
          const decimals = parseInt(tx.tokenDecimal) || 18;
          const isSend = tx.from.toLowerCase() === wallet.toLowerCase();
          // Detect swaps (same tx hash appears twice with different tokens)
          const isSwap = transactions.some(t => t.hash === tx.hash && t.asset !== tx.tokenSymbol);
          transactions.push({
            hash: tx.hash,
            kind: isSwap ? "SWAP" : (isSend ? "SEND" : "RECEIVE"),
            asset: tx.tokenSymbol || "TOKEN",
            amount: (parseFloat(tx.value) / Math.pow(10, decimals)).toFixed(6),
            timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
            status: "confirmed",
            explorer_url: `https://etherscan.io/tx/${tx.hash}`,
            from: tx.from,
            to: tx.to,
            contract_address: tx.contractAddress,
          });
        });
      }

      // Sort by timestamp and dedupe
      transactions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      const uniqueTxs = transactions.slice(0, 20);

      // Cache the result
      txCache.set(cacheKey, { data: uniqueTxs, timestamp: Date.now() });

      res.json({ 
        transactions: uniqueTxs, 
        source: "etherscan",
        fetched_at: new Date().toISOString()
      });
    } catch (error: any) {
      console.error("Transaction fetch error:", error.message);
      const reason = error.code === "ECONNABORTED" ? "timeout" 
        : error.response?.status === 429 ? "rate_limited"
        : "api_error";
      res.status(500).json({ error: error.message, reason });
    }
  }
);

// ============================================
// MARKET SNAPSHOTS (Price Deviation History)
// ============================================

// Store a market snapshot
router.post(
  "/me/market-snapshot",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      const { market, cex_bid, cex_ask, dex_price, edge_bps, cost_bps, edge_after_cost_bps } = req.body;

      if (!market || cex_bid === undefined || dex_price === undefined) {
        return res.status(400).json({ error: "Missing required fields: market, cex_bid, dex_price" });
      }

      const { error } = await supabase.from("market_snapshots").insert({
        user_id: req.userId,
        market,
        cex_bid,
        cex_ask,
        dex_price,
        edge_bps,
        cost_bps,
        edge_after_cost_bps,
        timestamp: new Date().toISOString(),
      });

      if (error) throw error;

      res.json({ success: true });
    } catch (error: any) {
      console.error("Market snapshot error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get market snapshots (Last N for history chart)
router.get(
  "/me/market-snapshots",
  requireAuth,
  async (req: AuthenticatedRequest, res) => {
    try {
      const supabase = getSupabase();
      if (!supabase) {
        return res.status(500).json({ error: "Database not configured" });
      }

      const market = req.query.market as string;
      const limit = parseInt(req.query.limit as string) || 20;

      let query = supabase
        .from("market_snapshots")
        .select("*")
        .eq("user_id", req.userId)
        .order("timestamp", { ascending: false })
        .limit(limit);

      if (market) {
        query = query.eq("market", market);
      }

      const { data, error } = await query;
      if (error) throw error;

      res.json({ snapshots: data || [] });
    } catch (error: any) {
      console.error("Get snapshots error:", error);
      res.status(500).json({ error: error.message });
    }
  }
);

// ============================================
// HEALTH ENDPOINTS (per service)
// ============================================

router.get("/health/etherscan", async (_req, res) => {
  const apiKey = process.env.ETHERSCAN_API_KEY;
  if (!apiKey) {
    return res.json({ status: "error", reason: "missing_api_key" });
  }
  try {
    const response = await axios.get(
      `https://api.etherscan.io/api?module=stats&action=ethprice&apikey=${apiKey}`,
      { timeout: 5000 }
    );
    if (response.data.status === "1") {
      res.json({ status: "connected", last_check: new Date().toISOString() });
    } else {
      res.json({ status: "error", reason: response.data.message || "bad_response" });
    }
  } catch (error: any) {
    res.json({ status: "error", reason: error.code === "ECONNABORTED" ? "timeout" : "connection_failed" });
  }
});

router.get("/health/lbank", async (_req, res) => {
  try {
    const response = await axios.get("https://api.lbank.info/v2/accuracy.do", { timeout: 5000 });
    if (response.data?.result === true || response.status === 200) {
      res.json({ status: "connected", last_check: new Date().toISOString() });
    } else {
      res.json({ status: "error", reason: "bad_response" });
    }
  } catch (error: any) {
    const reason = error.code === "ECONNABORTED" ? "timeout"
      : error.response?.status === 429 ? "rate_limited"
      : error.response?.status === 401 ? "auth_failed"
      : "connection_failed";
    res.json({ status: "error", reason, details: error.message });
  }
});

router.get("/health/latoken", async (_req, res) => {
  try {
    const response = await axios.get("https://api.latoken.com/v2/time", { timeout: 5000 });
    if (response.status === 200) {
      res.json({ status: "connected", last_check: new Date().toISOString(), server_time: response.data });
    } else {
      res.json({ status: "error", reason: "bad_response" });
    }
  } catch (error: any) {
    const reason = error.code === "ECONNABORTED" ? "timeout"
      : error.response?.status === 429 ? "rate_limited"
      : error.response?.status === 401 ? "auth_failed"
      : "connection_failed";
    res.json({ status: "error", reason, details: error.message });
  }
});

router.get("/health/uniswap", async (_req, res) => {
  try {
    const rpcUrl = process.env.RPC_URL || "https://ethereum-rpc.publicnode.com";
    const response = await axios.post(rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 1
    }, { timeout: 5000 });
    if (response.data?.result) {
      res.json({ 
        status: "connected", 
        last_check: new Date().toISOString(),
        block_number: parseInt(response.data.result, 16)
      });
    } else {
      res.json({ status: "error", reason: "bad_response" });
    }
  } catch (error: any) {
    res.json({ status: "error", reason: error.code === "ECONNABORTED" ? "timeout" : "connection_failed" });
  }
});

export default router;
