import React, { useState, useEffect } from 'react';

interface CustodialRiskModalProps {
    isOpen: boolean;
    onConfirm: () => void;
    onCancel: () => void;
}

const CONFIRMATION_PHRASE = "I UNDERSTAND THE RISKS";

export const CustodialRiskModal: React.FC<CustodialRiskModalProps> = ({ isOpen, onConfirm, onCancel }) => {
    const [phraseInput, setPhraseInput] = useState('');
    const [isChecked, setIsChecked] = useState(false);
    const [canConfirm, setCanConfirm] = useState(false);

    useEffect(() => {
        setCanConfirm(phraseInput === CONFIRMATION_PHRASE && isChecked);
    }, [phraseInput, isChecked]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 backdrop-blur-sm">
            <div className="bg-slate-900 border border-red-500/50 rounded-lg shadow-2xl max-w-lg w-full p-6 relative">
                <div className="flex items-center gap-3 mb-4 text-red-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h2 className="text-xl font-bold tracking-wider">CUSTODIAL RISK WARNING</h2>
                </div>

                <div className="space-y-4 text-gray-300 text-sm mb-6">
                    <p className="font-semibold text-red-400">
                        YOU ARE ENABLING AUTONOMOUS EXECUTION MODE.
                    </p>
                    <p>
                        By enabling this mode, you grant the system permission to sign and broadcast transactions using the connected custodial wallet.
                    </p>
                    <ul className="list-disc pl-5 space-y-1 text-gray-400">
                        <li>Trades will be executed automatically based on arbitrage logic.</li>
                        <li>Flashbots protection is enabled but not guaranteed.</li>
                        <li>Impermanent loss and gas costs are your responsibility.</li>
                        <li>Software is provided "AS IS" without warranty of any kind.</li>
                    </ul>
                </div>

                <div className="space-y-4 bg-slate-950 p-4 rounded border border-slate-800">
                    <label className="flex items-start gap-3 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => setIsChecked(e.target.checked)}
                            className="mt-1 w-4 h-4 text-red-600 bg-slate-800 border-slate-600 rounded focus:ring-red-500"
                        />
                        <span className="text-sm text-gray-300">
                            I have read the security documentation and accept full liability for all automated transactions.
                        </span>
                    </label>

                    <div>
                        <label className="block text-xs font-mono text-gray-500 mb-1">
                            TYPE "{CONFIRMATION_PHRASE}" TO CONFIRM:
                        </label>
                        <input
                            type="text"
                            value={phraseInput}
                            onChange={(e) => setPhraseInput(e.target.value)}
                            onPaste={(e) => { e.preventDefault(); }}
                            className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-2 text-white font-mono text-sm focus:border-red-500 focus:outline-none"
                            placeholder={CONFIRMATION_PHRASE}
                        />
                    </div>
                </div>

                <div className="flex gap-3 mt-6 justify-end">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={!canConfirm}
                        className={`px-4 py-2 rounded font-bold transition-all ${canConfirm
                                ? 'bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-900/20'
                                : 'bg-slate-800 text-gray-500 cursor-not-allowed'
                            }`}
                    >
                        ENABLE AUTO MODE
                    </button>
                </div>
            </div>
        </div>
    );
};
