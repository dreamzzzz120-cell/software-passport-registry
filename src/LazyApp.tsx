/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';

const App = lazy(() => import('./App'));

function AppBoot() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
      <div className="max-w-lg text-center" role="status" aria-live="polite">
        <div className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">SPR</div>
        <div className="mt-3 text-sm text-slate-300">Loading secure workspace…</div>
      </div>
    </div>
  );
}

interface BootBoundaryProps {
  children: ReactNode;
}

interface BootBoundaryState {
  error: Error | null;
}

class BootBoundary extends Component<BootBoundaryProps, BootBoundaryState> {
  state: BootBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BootBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SPR boot]', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.message || 'The application could not start.';
    const firebaseConfigMissing = message.includes('VITE_FIREBASE_');

    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-3xl border border-red-400/20 bg-white/[.04] p-8 shadow-2xl">
          <div className="text-xs font-bold uppercase tracking-[.25em] text-red-300">SPR startup failure</div>
          <h1 className="mt-3 text-2xl font-semibold">The workspace could not start.</h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            {firebaseConfigMissing
              ? 'Firebase web configuration is missing from this deployment. Add the required VITE_FIREBASE_* variables to the Vercel environment, then redeploy.'
              : 'A client module failed during startup. The page is showing the real startup error instead of remaining blank.'}
          </p>
          <pre className="mt-5 overflow-auto rounded-2xl border border-white/10 bg-black/30 p-4 text-xs text-slate-400">{message}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-bold text-slate-950"
          >
            Reload application
          </button>
        </div>
      </div>
    );
  }
}

export default function LazyApp() {
  return (
    <BootBoundary>
      <Suspense fallback={<AppBoot />}>
        <App />
      </Suspense>
    </BootBoundary>
  );
}
