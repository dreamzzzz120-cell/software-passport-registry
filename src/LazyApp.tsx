/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';

const App = lazy(() => import('./App'));

function AppBoot() {
  return (
    <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4] flex items-center justify-center px-6">
      <div className="max-w-lg text-center" role="status" aria-live="polite">
        <div className="text-xs font-bold uppercase tracking-[.25em] text-[#3794ff]">SPR</div>
        <div className="mt-3 text-sm text-[#9d9d9d]">Loading secure workspace…</div>
      </div>
    </div>
  );
}

interface BootBoundaryState {
  error: Error | null;
}

class BootBoundary extends Component<{ children?: ReactNode }, BootBoundaryState> {
  state: BootBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BootBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SPR boot]', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    // Read from props rather than a constructor-captured copy: a snapshot
    // taken at construction freezes the app tree at its first render.
    if (!error) return this.props.children;

    const message = error.message || 'The application could not start.';
    const firebaseConfigMissing = message.includes('VITE_FIREBASE_');

    return (
      <div className="min-h-screen bg-[#1e1e1e] text-[#d4d4d4] flex items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-md border border-[#f14c4c]/40 bg-[#252526] p-8">
          <div className="text-xs font-bold uppercase tracking-[.25em] text-[#f14c4c]">SPR startup failure</div>
          <h1 className="mt-3 text-2xl font-semibold">The workspace could not start.</h1>
          <p className="mt-3 text-sm leading-6 text-[#9d9d9d]">
            {firebaseConfigMissing
              ? 'Firebase web configuration is missing from this deployment. Add the required VITE_FIREBASE_* variables to the Vercel environment, then redeploy.'
              : 'A client module failed during startup. The page is showing the real startup error instead of remaining blank.'}
          </p>
          <pre className="mt-5 overflow-auto rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs text-[#9d9d9d]">{message}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-[3px] bg-[#0e639c] px-4 py-2.5 text-sm font-bold text-white"
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
