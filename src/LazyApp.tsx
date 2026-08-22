import { lazy, Suspense } from 'react';

const App = lazy(() => import('./App'));

function AppBoot() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
      <div className="text-center" role="status" aria-live="polite">
        <div className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">SPR</div>
        <div className="mt-3 text-sm text-slate-300">Loading secure workspace…</div>
      </div>
    </div>
  );
}

export default function LazyApp() {
  return (
    <Suspense fallback={<AppBoot />}>
      <App />
    </Suspense>
  );
}
