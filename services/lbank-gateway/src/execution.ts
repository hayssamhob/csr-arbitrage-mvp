
import { SupabaseClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import * as ccxt from "ccxt";

// Defined in index.ts or config, but re-declaring for clarity
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ExecutionRequest {
    type: 'execution.request';
    eventId: string;
    runId: string;
    userId: string;
    symbol: string;
    direction: 'buy_cex_sell_dex' | 'buy_dex_sell_cex';
    sizeUsdt: number;
    minProfitBps: number;
}

export class ExecutionHandler {
    private supabase: SupabaseClient;
    private secretsKey: string;
    private log: (level: LogLevel, event: string, data?: any) => void;

    constructor(
        supabase: SupabaseClient,
        secretsKey: string,
        logger: (level: LogLevel, event: string, data?: any) => void
    ) {
        this.supabase = supabase;
        this.secretsKey = secretsKey;
        this.log = logger;
    }

    // Helper to decrypt keys (AES-256-GCM)
    private decrypt(encryptedData: string): string {
        if (!this.secretsKey) throw new Error("CEX_SECRETS_KEY not configured");

        const [ivB64, tagB64, ciphertext] = encryptedData.split(":");
        if (!ivB64 || !tagB64 || !ciphertext) throw new Error("Invalid encrypted data format");

        const iv = Buffer.from(ivB64, "base64");
        const tag = Buffer.from(tagB64, "base64");

        const decipher = crypto.createDecipheriv(
            "aes-256-gcm",
            Buffer.from(this.secretsKey, "hex"),
            iv
        );
        decipher.setAuthTag(tag);

        let decrypted = decipher.update(ciphertext, "base64", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    }

    async execute(request: ExecutionRequest): Promise<{ success: boolean; orderId?: string; error?: string }> {
        if (!request.userId) {
            this.log('error', 'execution_skipped_no_user_id', { runId: request.runId });
            return { success: false, error: "Missing userId" };
        }

        // Determine side (buy/sell) on CEX
        // 'buy_cex_sell_dex' -> Buy on CEX
        // 'buy_dex_sell_cex' -> Sell on CEX
        const side = request.direction === 'buy_cex_sell_dex' ? 'buy' : 'sell';

        this.log('info', 'executing_cex_trade', {
            venue: 'lbank',
            userId: request.userId,
            symbol: request.symbol,
            side: side,
            size: request.sizeUsdt
        });

        try {
            // 1. Fetch User's LBank Credentials
            const { data: creds, error } = await this.supabase
                .from('exchange_credentials')
                .select('api_key_enc, api_secret_enc')
                .eq('user_id', request.userId)
                .eq('venue', 'lbank')
                .single();

            if (error || !creds || !creds.api_key_enc) {
                throw new Error(`Credentials not found for user ${request.userId} on LBank`);
            }

            // 2. Decrypt Keys
            const apiKey = this.decrypt(creds.api_key_enc);

            // LBank requires secret for trading (unlike some read-only APIs)
            if (!creds.api_secret_enc) {
                throw new Error("LBank API secret missing for user");
            }
            const apiSecret = this.decrypt(creds.api_secret_enc);

            // 3. Initialize CCXT Client (Transient for this user)
            const lbank = new ccxt.lbank({
                apiKey: apiKey,
                secret: apiSecret,
                enableRateLimit: true,
            });

            // 4. Execute Trade (Limit Order)
            // Note: We need Current Price to set a limit, or use 'market' if supported/safe.
            // For MVP arbitrage, we usually place Limit orders at the current top of book (taker)
            // or slightly better (maker).
            // Here we will fetch ticker first to get price.

            // Map symbol: CSR/USDT -> CSR/USDT (CCXT usually handles slash)
            // Ensure symbol format is correct for CCXT
            const ccxtSymbol = request.symbol.includes('/') ? request.symbol : request.symbol.replace('_', '/').toUpperCase();

            const ticker = await lbank.fetchTicker(ccxtSymbol);
            const price = side === 'buy' ? ticker.ask : ticker.bid; // Taker price (immediate fill likely)

            if (!price) throw new Error("Failed to fetch current price from LBank");

            // Calculate amount (Base Asset) from sizeUsdt (Quote Asset)
            const amount = request.sizeUsdt / price;

            this.log('info', 'placing_order', {
                symbol: ccxtSymbol,
                side,
                price,
                amount: amount.toFixed(4)
            });

            // Place Order
            const order = await lbank.createOrder(ccxtSymbol, 'limit', side, amount, price);

            this.log('info', 'order_placed', {
                orderId: order.id,
                status: order.status
            });

            return { success: true, orderId: order.id };

        } catch (err: any) {
            this.log('error', 'execution_failed', {
                venue: 'lbank',
                runId: request.runId,
                error: err.message
            });
            return { success: false, error: err.message };
        }
    }
}
