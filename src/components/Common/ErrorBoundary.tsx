import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected application error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FAF8FB] dark:bg-[#0B1120] text-[#0F172A] dark:text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-2xl border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-[#131C31] p-6 space-y-4">
            <h1 className="font-display text-lg font-bold text-rose-700 dark:text-rose-400">
              PaperFlow Runtime Error
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed break-words font-mono">
              {this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-[#0F172A] dark:bg-pink-600 text-white text-xs font-semibold"
            >
              Reload Dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
