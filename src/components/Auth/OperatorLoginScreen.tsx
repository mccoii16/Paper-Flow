import React, { useState } from 'react';
import { ArrowRight, Lock, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export function OperatorLoginScreen() {
  const { signInWithGoogle, enterDemoMode, theme, toggleTheme, health } = useApp();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState('');

  const handleGoogleSignIn = async () => {
    setError('');
    setSigningIn(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Google Sign-In popup was cancelled or blocked.'
      );
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FAF8FB] text-[#0F172A] dark:bg-[#0B1120] dark:text-slate-100 flex flex-col justify-between p-6">
      <div className="flex items-center justify-between max-w-5xl w-full mx-auto">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0F172A] text-pink-300 dark:bg-pink-500 dark:text-white font-display font-bold text-sm">
            PF
          </div>
          <span className="font-display text-lg font-bold tracking-tight">PaperFlow</span>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          className="px-3.5 py-2 text-xs font-medium rounded-xl border border-[#E5E2EA] dark:border-slate-800 bg-white dark:bg-[#131C31] hover:bg-pink-50/60 dark:hover:bg-slate-800 transition-colors"
        >
          {theme === 'light' ? 'Switch to Dark' : 'Switch to Light'}
        </button>
      </div>

      <main className="max-w-md w-full mx-auto my-10">
        <div className="rounded-2xl border border-[#E5E2EA] dark:border-slate-800 bg-white dark:bg-[#131C31] p-7 space-y-5">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-pink-700 dark:text-pink-300 mb-2">
              <Lock className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Paper Dreams Cebu · Admin Portal</span>
            </div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-[#0F172A] dark:text-white">
              Sign in to PaperFlow
            </h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Sign in with Google via Firebase Authentication to access live Firestore data and Meta Messenger operations, or launch Local Demo Mode for sandbox testing.
            </p>
          </div>

          {error && (
            <p
              className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/30 px-3.5 py-2.5 text-xs font-medium text-rose-700 dark:text-rose-300"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="space-y-3">
            <button
              type="button"
              disabled={signingIn}
              onClick={() => void handleGoogleSignIn()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#0F172A] hover:bg-[#1E293B] dark:bg-pink-600 dark:hover:bg-pink-500 disabled:opacity-60 text-white px-4 py-2.5 text-sm font-semibold transition-colors"
            >
              <span>{signingIn ? 'Connecting Google Sign-In...' : 'Sign in with Google (Firebase)'}</span>
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => enterDemoMode()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-[#E5E2EA] dark:border-slate-700 bg-[#FAF8FB] dark:bg-[#0B1120] hover:bg-pink-50/70 dark:hover:bg-slate-800 text-[#0F172A] dark:text-slate-200 px-4 py-2.5 text-xs font-semibold transition-colors"
            >
              <span>Open Local Demo Mode (Sample Data Only)</span>
            </button>
          </div>

          <div className="pt-4 border-t border-[#E5E2EA] dark:border-slate-800 flex items-start gap-2.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-4 w-4 shrink-0 text-pink-600 dark:text-pink-400 mt-0.5" aria-hidden="true" />
            <span>
              Firebase project: <strong className="font-mono text-[#0F172A] dark:text-slate-200">{health?.firebaseProjectId || 'paperflow-46498'}</strong>. Backend routes verify Firebase ID tokens via Admin SDK; Meta Page tokens stay strictly server-side.
            </span>
          </div>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500 dark:text-slate-400">
        Paper Dreams Cebu · Stage 2 Firebase & Meta Integration
      </footer>
    </div>
  );
}
