/**
 * UserDataContext - Global state management for user data
 * 
 * Loads user settings, balances, and risk limits on app initialization
 * Shares data across all pages without per-page loading delays
 * 
 * This is the PROFESSIONAL approach - data loads once at app start
 */

import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.PROD ? "" : "http://localhost:8001");

// User risk limits and settings
export interface UserLimits {
  loaded: boolean;
  kill_switch: boolean;
  min_edge_bps: number;
  max_position_usd: number;
  max_slippage_bps: number;
  daily_loss_limit_usd: number;
  allowed_venues: string[];
}

// Balance for a single asset on a venue
export interface VenueBalance {
  venue: string;
  asset: string;
  available: number;
  locked: number;
  total: number;
  usd_value: number;
}

// Exchange connection status
export interface ExchangeStatus {
  connected: boolean;
  error?: string;
  last_update?: string;
}

// User inventory data
export interface UserInventory {
  loaded: boolean;
  balances: VenueBalance[];
  total_usd: number;
  exchange_statuses: Record<string, ExchangeStatus>;
  saved_wallet_address?: string;
}

// Exchange credentials (non-sensitive info only)
export interface ExchangeCredential {
  venue: string;
  has_credentials: boolean;
  last_updated?: string;
}

interface UserDataContextType {
  // User limits/settings
  limits: UserLimits;
  
  // User inventory/balances
  inventory: UserInventory;
  
  // Exchange credentials status
  credentials: ExchangeCredential[];
  
  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Refresh functions
  refreshLimits: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshCredentials: () => Promise<void>;
  refreshAll: () => Promise<void>;
  
  // Update functions
  updateLimits: (newLimits: Partial<UserLimits>) => Promise<boolean>;
}

const defaultLimits: UserLimits = {
  loaded: false,
  kill_switch: true, // Safe default
  min_edge_bps: 50,
  max_position_usd: 1000,
  max_slippage_bps: 100,
  daily_loss_limit_usd: 100,
  allowed_venues: ["LATOKEN", "LBank", "Uniswap"],
};

const defaultInventory: UserInventory = {
  loaded: false,
  balances: [],
  total_usd: 0,
  exchange_statuses: {},
  saved_wallet_address: undefined,
};

const UserDataContext = createContext<UserDataContextType | null>(null);

export function UserDataProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  
  const [limits, setLimits] = useState<UserLimits>(defaultLimits);
  const [inventory, setInventory] = useState<UserInventory>(defaultInventory);
  const [credentials, setCredentials] = useState<ExchangeCredential[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get auth headers
  const getHeaders = useCallback(() => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (session?.access_token) {
      headers["Authorization"] = `Bearer ${session.access_token}`;
    }
    return headers;
  }, [session]);

  // Fetch user limits/settings
  const refreshLimits = useCallback(async () => {
    if (!session?.access_token) return;
    
    try {
      const resp = await fetch(`${API_URL}/api/me/risk-limits`, {
        headers: getHeaders(),
      });
      
      if (resp.ok) {
        const data = await resp.json();
        setLimits({
          loaded: true,
          kill_switch: data.kill_switch ?? true,
          min_edge_bps: data.min_edge_bps ?? 50,
          max_position_usd: data.max_position_usd ?? 1000,
          max_slippage_bps: data.max_slippage_bps ?? 100,
          daily_loss_limit_usd: data.daily_loss_limit_usd ?? 100,
          allowed_venues: data.allowed_venues ?? ["LATOKEN", "LBank", "Uniswap"],
        });
      } else {
        console.error("[UserData] Failed to fetch limits:", resp.status);
      }
    } catch (e) {
      console.error("[UserData] Error fetching limits:", e);
    }
  }, [session, getHeaders]);

  // Fetch user inventory/balances
  const refreshInventory = useCallback(async () => {
    if (!session?.access_token) return;
    
    try {
      const resp = await fetch(`${API_URL}/api/me/balances`, {
        headers: getHeaders(),
      });
      
      if (resp.ok) {
        const data = await resp.json();
        
        // Normalize venue names (backend returns lowercase)
        const normalizedBalances = (data.balances || []).map((b: VenueBalance) => ({
          ...b,
          venue: b.venue.toUpperCase() === "LATOKEN" ? "LATOKEN" : 
                 b.venue.toUpperCase() === "LBANK" ? "LBank" : b.venue,
        }));
        
        // Normalize exchange statuses
        const normalizedStatuses: Record<string, ExchangeStatus> = {};
        for (const [key, value] of Object.entries(data.exchange_statuses || {})) {
          const normalizedKey = key.toUpperCase() === "LATOKEN" ? "LATOKEN" :
                               key.toUpperCase() === "LBANK" ? "LBank" : key;
          normalizedStatuses[normalizedKey] = value as ExchangeStatus;
        }
        
        setInventory({
          loaded: true,
          balances: normalizedBalances,
          total_usd: data.total_usd || 0,
          exchange_statuses: normalizedStatuses,
          saved_wallet_address: data.wallet_address,
        });
      } else {
        console.error("[UserData] Failed to fetch balances:", resp.status);
      }
    } catch (e) {
      console.error("[UserData] Error fetching balances:", e);
    }
  }, [session, getHeaders]);

  // Fetch exchange credentials status
  const refreshCredentials = useCallback(async () => {
    if (!session?.access_token) return;
    
    try {
      const resp = await fetch(`${API_URL}/api/me/exchange-credentials`, {
        headers: getHeaders(),
      });
      
      if (resp.ok) {
        const data = await resp.json();
        setCredentials(data.credentials || []);
      }
    } catch (e) {
      console.error("[UserData] Error fetching credentials:", e);
    }
  }, [session, getHeaders]);

  // Refresh all data
  const refreshAll = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      await Promise.all([
        refreshLimits(),
        refreshInventory(),
        refreshCredentials(),
      ]);
    } catch (e) {
      setError("Failed to load user data");
      console.error("[UserData] Error refreshing all:", e);
    } finally {
      setIsLoading(false);
    }
  }, [refreshLimits, refreshInventory, refreshCredentials]);

  // Update user limits
  const updateLimits = useCallback(async (newLimits: Partial<UserLimits>): Promise<boolean> => {
    if (!session?.access_token) return false;
    
    try {
      const resp = await fetch(`${API_URL}/api/me/risk-limits`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify(newLimits),
      });
      
      if (resp.ok) {
        // Refresh limits after update
        await refreshLimits();
        return true;
      }
      return false;
    } catch (e) {
      console.error("[UserData] Error updating limits:", e);
      return false;
    }
  }, [session, getHeaders, refreshLimits]);

  // Load all data when user authenticates
  useEffect(() => {
    if (user && session?.access_token) {
      console.log("[UserData] User authenticated, loading all data...");
      refreshAll();
    } else {
      // Reset to defaults when logged out
      setLimits(defaultLimits);
      setInventory(defaultInventory);
      setCredentials([]);
    }
  }, [user, session?.access_token, refreshAll]);

  // Periodic refresh every 30 seconds
  useEffect(() => {
    if (!user || !session?.access_token) return;
    
    const interval = setInterval(() => {
      refreshInventory(); // Refresh balances periodically
    }, 30000);
    
    return () => clearInterval(interval);
  }, [user, session?.access_token, refreshInventory]);

  return (
    <UserDataContext.Provider
      value={{
        limits,
        inventory,
        credentials,
        isLoading,
        error,
        refreshLimits,
        refreshInventory,
        refreshCredentials,
        refreshAll,
        updateLimits,
      }}
    >
      {children}
    </UserDataContext.Provider>
  );
}

export function useUserData() {
  const context = useContext(UserDataContext);
  if (!context) {
    throw new Error("useUserData must be used within a UserDataProvider");
  }
  return context;
}
