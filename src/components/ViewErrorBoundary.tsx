/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; routeKey: string }
interface State { error: Error | null; incidentId: string | null }

function makeIncidentId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `spr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Route-scoped crash boundary: keep the shell alive and never expose internals. */
export default class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null, incidentId: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, incidentId: makeIncidentId() };
  }

  componentDidUpdate(previous: Props) {
    if (previous.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null, incidentId: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SPR view error]', {
      incidentId: this.state.incidentId,
      route: this.props.routeKey,
      message: error.message,
      componentStack: info?.componentStack,
    });
  }

  render() {
    const { error, incidentId } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="rounded-md border border-[var(--spr-red)]/40 bg-[var(--spr-surface-alt)] p-6 md:p-8" role="alert" aria-live="assertive">
        <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[var(--spr-red)]">View error</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--spr-text)]">This view could not be displayed.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--spr-text-muted)]">
          SPR kept the rest of the application running. Try the page again or use the navigation to continue.
        </p>
        {incidentId && <p className="mt-3 text-xs text-[var(--spr-text-faint)]" role="status">Reference: <code>{incidentId}</code></p>}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="button" onClick={() => this.setState({ error: null, incidentId: null })} className="rounded-[3px] bg-[var(--spr-accent)] px-4 py-2.5 text-sm font-bold text-white">Try again</button>
          <button type="button" onClick={() => window.location.reload()} className="rounded-[3px] border border-[var(--spr-border)] px-4 py-2.5 text-sm font-semibold text-[var(--spr-text)]">Reload application</button>
        </div>
      </section>
    );
  }
}
