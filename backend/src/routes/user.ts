/**
 * User API Routes
 * 
 * All routes require authentication and are scoped to the authenticated user.
 * Handles risk limits, wallets, and exchange credentials.
 */

import { createClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { Router } from 'express';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';

const router = Router();

// Supabase client for database operations
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Supabase credentials not configured for user routes');
}

const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Encryption key for CEX secrets (stored only on VPS)
const CEX_SECRETS_KEY = process.env.CEX_SECRETS_KEY;

// Encryption helpers using AES-256-GCM
function encrypt(text: string): string {
  if (!CEX_SECRETS_KEY) throw new Error('CEX_SECRETS_KEY not configured');
  
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(
    'aes-256-gcm',
    Buffer.from(CEX_SECRETS_KEY, 'hex'),
    iv
  );
  
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted}`;
}

function decrypt(encryptedData: string): string {
  if (!CEX_SECRETS_KEY) throw new Error('CEX_SECRETS_KEY not configured');
  
  const [ivB64, tagB64, ciphertext] = encryptedData.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(CEX_SECRETS_KEY, 'hex'),
    iv
  );
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(ciphertext, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// GET /api/me/risk-limits
router.get('/risk-limits', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { data, error } = await supabase
    .from('risk_limits')
    .select('*')
    .eq('user_id', req.userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return res.status(500).json({ error: error.message });
  }

  // Return defaults if no record exists
  res.json(data || {
    max_order_usdt: 1000,
    daily_limit_usdt: 10000,
    min_edge_bps: 50,
    max_slippage_bps: 100,
    kill_switch: true,
  });
});

// PUT /api/me/risk-limits
router.put('/risk-limits', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { max_order_usdt, daily_limit_usdt, min_edge_bps, max_slippage_bps, kill_switch } = req.body;

  const { data, error } = await supabase
    .from('risk_limits')
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
  await supabase.from('audit_log').insert({
    user_id: req.userId,
    action: 'risk_limits_updated',
    metadata: { changes: req.body },
  });

  res.json(data);
});

// GET /api/me/wallets
router.get('/wallets', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { data, error } = await supabase
    .from('wallets')
    .select('id, chain, address, label, created_at')
    .eq('user_id', req.userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json(data || []);
});

// POST /api/me/wallets
router.post('/wallets', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { chain, address, label } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }

  const { data, error } = await supabase
    .from('wallets')
    .insert({
      user_id: req.userId,
      chain: chain || 'ethereum',
      address,
      label,
    })
    .select()
    .single();

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Log the change
  await supabase.from('audit_log').insert({
    user_id: req.userId,
    action: 'wallet_added',
    metadata: { chain, address: address.slice(0, 10) + '...' },
  });

  res.json(data);
});

// DELETE /api/me/wallets/:id
router.delete('/wallets/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { error } = await supabase
    .from('wallets')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ success: true });
});

// GET /api/me/exchanges - Returns status only, NO secrets
router.get('/exchanges', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const { data, error } = await supabase
    .from('exchange_credentials')
    .select('id, venue, last_test_ok, last_test_error, last_test_at, created_at, updated_at')
    .eq('user_id', req.userId);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  // Transform to status-only format
  const exchanges = (data || []).map((cred: any) => ({
    venue: cred.venue,
    connected: true,
    last_test_ok: cred.last_test_ok,
    last_test_error: cred.last_test_error,
    last_test_at: cred.last_test_at,
    created_at: cred.created_at,
  }));

  res.json(exchanges);
});

// POST /api/me/exchanges/:venue - Save/update encrypted credentials
router.post('/exchanges/:venue', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const venue = req.params.venue.toLowerCase();
  if (!['lbank', 'latoken'].includes(venue)) {
    return res.status(400).json({ error: 'Invalid venue. Use lbank or latoken' });
  }

  const { api_key, api_secret, api_passphrase } = req.body;

  if (!api_key || !api_secret) {
    return res.status(400).json({ error: 'api_key and api_secret are required' });
  }

  if (!CEX_SECRETS_KEY) {
    return res.status(503).json({ error: 'Encryption not configured' });
  }

  try {
    const encryptedKey = encrypt(api_key);
    const encryptedSecret = encrypt(api_secret);
    const encryptedPassphrase = api_passphrase ? encrypt(api_passphrase) : null;

    const { data, error } = await supabase
      .from('exchange_credentials')
      .upsert({
        user_id: req.userId,
        venue,
        api_key_enc: encryptedKey,
        api_secret_enc: encryptedSecret,
        api_passphrase_enc: encryptedPassphrase,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,venue',
      })
      .select('id, venue, created_at, updated_at')
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Log the change (no secrets)
    await supabase.from('audit_log').insert({
      user_id: req.userId,
      action: 'exchange_credentials_updated',
      metadata: { venue },
    });

    res.json({ success: true, venue, updated_at: data.updated_at });
  } catch (err: any) {
    console.error('Encryption error:', err.message);
    return res.status(500).json({ error: 'Failed to encrypt credentials' });
  }
});

// POST /api/me/exchanges/:venue/test - Test API keys
router.post('/exchanges/:venue/test', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (!supabase) {
    return res.status(503).json({ error: 'Database not configured' });
  }

  const venue = req.params.venue.toLowerCase();
  if (!['lbank', 'latoken'].includes(venue)) {
    return res.status(400).json({ error: 'Invalid venue' });
  }

  // Get encrypted credentials
  const { data: creds, error } = await supabase
    .from('exchange_credentials')
    .select('api_key_enc, api_secret_enc, api_passphrase_enc')
    .eq('user_id', req.userId)
    .eq('venue', venue)
    .single();

  if (error || !creds) {
    return res.status(404).json({ error: 'Credentials not found for this venue' });
  }

  try {
    const apiKey = decrypt(creds.api_key_enc);
    const apiSecret = decrypt(creds.api_secret_enc);
    
    // TODO: Implement actual API test calls for each venue
    // For now, just verify decryption works
    const testResult = {
      success: true,
      message: 'Credentials decrypted successfully. API test not yet implemented.',
    };

    // Update test result in DB
    await supabase
      .from('exchange_credentials')
      .update({
        last_test_ok: testResult.success,
        last_test_error: testResult.success ? null : testResult.message,
        last_test_at: new Date().toISOString(),
      })
      .eq('user_id', req.userId)
      .eq('venue', venue);

    // Log the test
    await supabase.from('audit_log').insert({
      user_id: req.userId,
      action: 'exchange_credentials_tested',
      metadata: { venue, success: testResult.success },
    });

    res.json(testResult);
  } catch (err: any) {
    console.error('Decryption/test error:', err.message);
    
    await supabase
      .from('exchange_credentials')
      .update({
        last_test_ok: false,
        last_test_error: 'Decryption failed',
        last_test_at: new Date().toISOString(),
      })
      .eq('user_id', req.userId)
      .eq('venue', venue);

    return res.status(500).json({ error: 'Failed to test credentials' });
  }
});

export default router;
