/**
 * LoginPage - Supabase Auth with email magic link
 */

import { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function LoginPage() {
  const { user, loading, signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const location = useLocation();

  // Get the redirect path from state, or default to /alignment
  const from = (location.state as { from?: string })?.from || "/alignment";

  // If already logged in, redirect to the intended destination
  if (!loading && user) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const { error } = await signInWithEmail(email);

    if (error) {
      setMessage({ type: "error", text: error.message });
    } else {
      setMessage({
        type: "success",
        text: "Check your email for the magic link! Click it to sign in.",
      });
      setEmail("");
    }

    setIsSubmitting(false);
  };

  if (loading) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="text-slate-400 animate-pulse">Loading...</div>
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
              Sign in to CSR Trading Hub
            </h1>
            <p className="text-slate-400 text-sm">
              Enter your email to receive a passwordless magic link
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-slate-300 mb-2"
              >
                Email Address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
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
                {message.type === "success" && (
                  <span className="mr-2">✉️</span>
                )}
                {message.text}
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting || !email}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white py-3 rounded-xl font-semibold transition-colors"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⏳</span> Sending...
                </span>
              ) : (
                "Send Magic Link"
              )}
            </button>
          </form>

          {/* Footer */}
          <p className="mt-6 text-center text-xs text-slate-500">
            By signing in, you agree to our terms of service.
            <br />
            Your data is protected with row-level security.
          </p>
        </div>
      </div>
    </div>
  );
}
