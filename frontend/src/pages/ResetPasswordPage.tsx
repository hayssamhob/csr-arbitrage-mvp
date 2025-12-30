/**
 * ResetPasswordPage - Reset password with token from email
 */

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Check if this is a password recovery session
  useEffect(() => {
    const checkRecoverySession = async () => {
      // Check URL hash for recovery token
      const hash = window.location.hash;
      const isRecovery =
        hash.includes("type=recovery") || hash.includes("type=signup");

      if (isRecovery) {
        console.log("[ResetPassword] Recovery mode detected");
        setIsRecoveryMode(true);
        setLoading(false);
        return;
      }

      // Check if user has an active session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        // Check if this session came from a recovery flow
        // If not, redirect to alignment
        console.log("[ResetPassword] Session exists, checking type");
        // For now, if they landed here with a session, let them reset
        setIsRecoveryMode(true);
      }

      setLoading(false);
    };

    // Listen for auth state changes (recovery token processed)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, _session) => {
      console.log("[ResetPassword] Auth event:", event);
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true);
        setLoading(false);
      }
    });

    checkRecoverySession();

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    if (password.length < 6) {
      setMessage({
        type: "error",
        text: "Password must be at least 6 characters",
      });
      setIsSubmitting(false);
      return;
    }

    if (password !== confirmPassword) {
      setMessage({ type: "error", text: "Passwords do not match" });
      setIsSubmitting(false);
      return;
    }

    // Use updateUser to set the new password
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error("[ResetPassword] Error:", error);
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({
        type: "success",
        text: "Password reset successful! Redirecting to sign in...",
      });
      // Sign out after password reset so they can sign in fresh
      await supabase.auth.signOut();
      setTimeout(() => {
        navigate("/login");
      }, 2000);
    }

    setIsSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">
          Processing reset link...
        </div>
      </div>
    );
  }

  // If not in recovery mode, show error and redirect option
  if (!isRecoveryMode) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-8 shadow-xl text-center">
            <div className="text-amber-400 text-4xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-white mb-4">
              Invalid Reset Link
            </h1>
            <p className="text-slate-400 mb-6">
              This password reset link is invalid or has expired. Please request
              a new one.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-2xl border border-slate-700/50 p-8 shadow-xl">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <img
                src="/depollute-logo-256.png"
                alt="CSR Trading Hub"
                className="h-16 w-16 rounded-xl"
              />
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              Reset Password
            </h1>
            <p className="text-slate-400 text-sm">
              Enter your new password below
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                New Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 6 characters"
                required
                minLength={6}
                autoFocus
                className="w-full bg-slate-800/50 text-white px-4 py-3 rounded-xl border border-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors placeholder:text-slate-500"
              />
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
                minLength={6}
                className="w-full bg-slate-800/50 text-white px-4 py-3 rounded-xl border border-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 focus:outline-none transition-colors placeholder:text-slate-500"
              />
            </div>

            {message && (
              <div
                className={`p-4 rounded-xl text-sm ${
                  message.type === "success"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                    : "bg-red-500/20 text-red-300 border border-red-500/30"
                }`}
              >
                {message.type === "success" && <span className="mr-2">✓</span>}
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !password || !confirmPassword}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span> Resetting...
                </span>
              ) : (
                "Reset Password"
              )}
            </button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate("/login")}
              className="text-slate-400 hover:text-emerald-400 text-sm transition-colors"
            >
              ← Back to Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
