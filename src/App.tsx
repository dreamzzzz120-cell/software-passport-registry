/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

interface HealthState {
  status: 'checking' | 'healthy' | 'degraded' | 'offline';
  detail?: string;
}

export default function App() {
  const [health, setHealth] = useState<HealthState>({ status: 'checking' });

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const response = await fetch('/health', { headers: { Accept: 'application/json' } });
        if (!active) return;
        if (!response.ok) {
          setHealth({ status: 'degraded', detail: `HTTP ${response.status}` });
          return;
        }
        const body = await response.json().catch(() => ({}));
        setHealth({ status: 'healthy', detail: typeof body?.status === 'string' ? body.status : 'operational' });
      } catch {
        if (active) setHealth({ status: 'offline', detail: 'API unavailable' });
      }
    };
    void check();
    const timer = window.setInterval(check, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const statusLabel = {
    checking: 'Checking system health…',
    healthy: 'System operational',
    degraded: 'System degraded',
    offline: 'API unavailable',
  }[health.status];

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-10">
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">SPR</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">Software Passport Registry</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">
              Evidence-first software trust, verification, monitoring, and supply-chain visibility.
            </p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200">
            {statusLabel}
          </div>
        </header>

        <section className="grid flex-1 items-center gap-6 py-12 md:grid-cols-3">
          <article className="rounded-2xl border border-white/10 bg-white/5 p-6 md:col-span-2">
            <h2 className="text-xl font-semibold">Trust infrastructure online</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              SPR is designed to report observed evidence, preserve provenance, and keep trust decisions
              auditable rather than inventing confidence where evidence is missing.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-200" href="/registry">Open Registry</a>
              <a className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10" href="/free-review">Run Free Review</a>
              <a className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold hover:bg-white/10" href="/pricing">View Plans</a>
            </div>
          </article>

          <aside className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Runtime status</p>
            <p className="mt-3 text-2xl font-bold">{health.status === 'healthy' ? 'Healthy' : health.status}</p>
            <p className="mt-2 text-sm text-slate-400">{health.detail ?? 'Waiting for health check.'}</p>
          </aside>
        </section>

        <footer className="border-t border-white/10 pt-6 text-xs text-slate-500">
          Software Passport Registry · Evidence-first trust infrastructure
        </footer>
      </div>
    </main>
  );
}

// Deployment synchronization marker: current main source is the intended production entrypoint.
