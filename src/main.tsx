import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './login-premium.css';

function BootstrapError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="min-h-screen bg-slate-950 px-6 py-12 text-white">
      <div className="mx-auto max-w-2xl rounded-2xl border border-red-400/20 bg-slate-900 p-6 shadow-2xl">
        <div className="text-xs font-bold uppercase tracking-[.25em] text-cyan-300">SPR Trust OS</div>
        <h1 className="mt-3 text-2xl font-bold">Frontend failed to initialize</h1>
        <p className="mt-3 text-slate-300">The server is reachable, but the browser application could not load. This diagnostic is shown instead of a blank page so the failure is actionable.</p>
        <pre className="mt-5 overflow-auto rounded-lg bg-black/40 p-4 text-xs text-red-200">{message}</pre>
        <button className="mt-5 rounded-lg bg-cyan-300 px-4 py-2 font-semibold text-slate-950" onClick={() => window.location.reload()}>Reload</button>
      </div>
    </div>
  );
}

function Bootstrap() {
  const [error, setError] = React.useState<unknown>(null);
  const [AppTree, setAppTree] = React.useState<ReactNode>(null);

  React.useEffect(() => {
    let cancelled = false;
    void Promise.all([import('./App.tsx'), import('./components/AuthGate.tsx')])
      .then(([appModule, authModule]) => {
        if (cancelled) return;
        const App = appModule.default;
        const AuthGate = authModule.default;
        setAppTree(
          <StrictMode>
            <AuthGate>
              <App />
            </AuthGate>
          </StrictMode>,
        );
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError);
      });
    return () => { cancelled = true; };
  }, []);

  if (error) return <BootstrapError error={error} />;
  if (!AppTree) {
    return <div className="min-h-screen bg-slate-950 text-white grid place-items-center"><div role="status" aria-live="polite" className="text-sm text-slate-300">Loading SPR Trust OS…</div></div>;
  }
  return <>{AppTree}</>;
}

// React is imported lazily here only to keep the initial bootstrap tiny and to
// let module-load failures render a diagnostic screen rather than a white page.
import * as React from 'react';

createRoot(document.getElementById('root')!).render(<Bootstrap />);
