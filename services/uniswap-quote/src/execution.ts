import { WalletClient, PublicClient, createWalletClient, http as viemHttp } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import { SupabaseClient } from "@supabase/supabase-js";
import * as crypto from "crypto";
import { v4 as uuidv4 } from "uuid";
import { LogLevel } from "./index";

// Execution Request Type
export interface ExecutionRequest {
    type: 'execution.request';
    eventId: string;
    runId: string;
    userId: string; // Crucial for multi-tenant
    symbol: string;
    direction: 'buy_cex_sell_dex' | 'buy_dex_sell_cex';
    sizeUsdt: number;
    minProfitBps: number;
}

export class ExecutionHandler {
    private publicClient: PublicClient;
    private supabase: SupabaseClient;
    private secretsKey: string;
    private rpcUrl: string;
    private log: (level: LogLevel, event: string, data?: any) => void;

    constructor(
        publicClient: PublicClient,
        supabase: SupabaseClient,
        secretsKey: string,
        rpcUrl: string,
        logger: (level: LogLevel, event: string, data?: any) => void
    ) {
        this.publicClient = publicClient;
        this.supabase = supabase;
        this.secretsKey = secretsKey;
        this.rpcUrl = rpcUrl;
        this.log = logger;
    }

    // Helper to decrypt private keys (AES-256-GCM)
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

    async execute(request: ExecutionRequest): Promise<{ success: boolean; txHash?: string; error?: string }> {
        if (!request.userId) {
            this.log('error', 'execution_skipped_no_user_id', { runId: request.runId });
            return { success: false, error: "Missing userId" };
        }

        this.log('info', 'executing_trade_for_user', {
            runId: request.runId,
            userId: request.userId,
            symbol: request.symbol,
            direction: request.direction,
            size: request.sizeUsdt
        });

        try {
            // 1. Fetch User's Custodial Wallet
            const { data: wallet, error } = await this.supabase
                .from('wallets')
                .select('private_key_enc, address')
                .eq('user_id', request.userId)
                .eq('is_custodial', true)
                .single();

            if (error || !wallet || !wallet.private_key_enc) {
                throw new Error(`Custodial wallet not found for user ${request.userId}`);
            }

            // 2. Decrypt Private Key
            let privateKey: string;
            try {
                privateKey = this.decrypt(wallet.private_key_enc);
            } catch (err: any) {
                throw new Error(`Decryption failed: ${err.message}`);
            }

            if (!privateKey.startsWith("0x")) {
                // Handle cases where 0x might be missing or raw key
                // For now assume it was stored correctly, or prepend 0x if length match
                if (privateKey.length === 64) privateKey = "0x" + privateKey;
            }

            // 3. Initialize Wallet Client (Transient)
            const account = privateKeyToAccount(privateKey as `0x${string}`);
            const walletClient = createWalletClient({
                account,
                chain: mainnet,
                transport: viemHttp(this.rpcUrl),
            });

            this.log('info', 'wallet_loaded', { address: account.address });

            // 4. Execute Trade (Placeholder for V4 Swap)
            // TODO: Construct Swap Call
            // For now, simulate success after retrieving key
            await new Promise(resolve => setTimeout(resolve, 500));
            const mockTxHash = "0x" + uuidv4().replace(/-/g, "");

            this.log('info', 'trade_simulated_success', {
                runId: request.runId,
                userId: request.userId,
                txHash: mockTxHash
            });

            return { success: true, txHash: mockTxHash };

        } catch (err: any) {
            this.log('error', 'execution_failed', {
                runId: request.runId,
                userId: request.userId,
                error: err.message
            });
            return { success: false, error: err.message };
        }
    }
}
