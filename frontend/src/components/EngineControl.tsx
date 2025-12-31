import React, { useState, useEffect } from 'react';

interface EngineControlProps {
    initialStatus?: { killSwitch: boolean; stealthMode: boolean };
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001';

export const EngineControl: React.FC<EngineControlProps> = ({ initialStatus }) => {
    const [killSwitchActive, setKillSwitchActive] = useState(initialStatus?.killSwitch || false);
    const [isStealth, setIsStealth] = useState(initialStatus?.stealthMode || true);
    const [loading, setLoading] = useState(false);

    const toggleKillSwitch = async () => {
        setLoading(true);
        const newState = !killSwitchActive;

        try {
            const response = await fetch(`${API_URL}/api/admin/kill-switch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ active: newState })
            });

            const data = await response.json();
            if (data.success) {
                setKillSwitchActive(data.kill_switch_active);
            }
        } catch (error) {
            console.error('Failed to toggle kill switch:', error);
            alert('CRITICAL ERROR: Failed to toggle engine kill switch. Please check network connection.');
        } finally {
            setLoading(false);
        }
    };

    // Poll for status periodically
    useEffect(() => {
        const fetchStatus = async () => {
            try {
                const res = await fetch(`${API_URL}/api/admin/engine-status`);
                const data = await res.json();
                setKillSwitchActive(data.kill_switch_active);
                setIsStealth(data.stealth_mode);
            } catch (e) {
                console.error('Status poll failed', e);
            }
        };

        fetchStatus(); // Initial fetch
        const interval = setInterval(fetchStatus, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex items-center gap-4 bg-slate-900/50 p-2 rounded-lg border border-slate-700">
            {/* Stealth Mode Indicator */}
            <div className={`flex items-center gap-2 px-3 py-1 rounded border text-xs font-mono uppercase tracking-wide ${isStealth
                    ? 'bg-emerald-950/30 border-emerald-900 text-emerald-400'
                    : 'bg-yellow-950/30 border-yellow-900 text-yellow-500'
                }`}>
                <span className={`w-2 h-2 rounded-full ${isStealth ? 'bg-emerald-500' : 'bg-yellow-500'} animate-pulse`}></span>
                {isStealth ? 'Flashbots Protected' : 'Public Mempool'}
            </div>

            {/* Divider */}
            <div className="h-6 w-px bg-slate-700"></div>

            {/* Kill Switch */}
            <button
                onClick={toggleKillSwitch}
                disabled={loading}
                className={`relative group flex items-center gap-2 px-4 py-1.5 rounded text-sm font-bold tracking-wider transition-all ${killSwitchActive
                        ? 'bg-red-600 text-white hover:bg-red-700 shadow-[0_0_15px_rgba(220,38,38,0.5)] border border-red-400'
                        : 'bg-slate-800 text-gray-400 hover:text-red-400 hover:border-red-900 border border-slate-700'
                    }`}
            >
                {killSwitchActive ? (
                    <>
                        <svg className="w-4 h-4 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        ENGINE KILLED
                    </>
                ) : (
                    <>
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        ENGINE ACTIVE
                    </>
                )}
            </button>
        </div>
    );
};
