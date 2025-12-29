/**
 * User API Routes
 * 
 * All routes require authentication and are scoped to the authenticated user.
 * Handles risk limits, wallets, and exchange credentials.
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { Router } from "express";
import { AuthenticatedRequest, requireAuth } from "../middleware/auth";

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

  res.json({
    balances,
    total_usd: balances.reduce((sum, b) => sum + (b.usd_value || 0), 0),
    exchange_statuses: exchangeStatuses,
    exposure: {
      max_per_trade_usd: limits?.max_order_usdt || 1000,
      max_daily_usd: limits?.daily_limit_usdt || 10000,
      used_daily_usd: 0, // TODO: Track from trade history
    },
    last_update: new Date().toISOString(),
    saved_wallet_address: savedWalletAddress,
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

export default router;
