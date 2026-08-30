/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode; routeKey: string }
interface State { error: Error | null }

/**
 * Catches a render/lifecycle crash inside a single authenticated view.
 *
 * Without this, any exception thrown while rendering a view unmounted the
 * entire React tree and left the bare dark page body - the "black screen"
 * with no message and nothing to act on. Scoping the boundary to the view
 * keeps the Command Center shell and its navigation alive, and shows what
 * actually failed so the rest of the app stays usable.
 *
 * Resetting when routeKey changes means navigating elsewhere clears the
 * error instead of trapping the user on the failed view.
 */
export default class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props) {
    if (previous.routeKey !== this.props.routeKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SPR view]', this.props.routeKey, error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <section className="rounded-md border border-[#f14c4c]/40 bg-[#252526] p-6 md:p-8" role="alert">
        <div className="text-[10px] font-semibold uppercase tracking-[.15em] text-[#f14c4c]">View error</div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#d4d4d4]">This view failed to render.</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[#9d9d9d]">
          The rest of SPR is still available - use the left rail to continue. The underlying
          error is shown below rather than leaving the screen blank.
        </p>
        <pre className="mt-5 overflow-auto rounded-md border border-[#3c3c3c] bg-[#181818] p-4 text-xs text-[#9d9d9d]">
          {error.message || String(error)}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-6 rounded-[3px] bg-[#0e639c] px-4 py-2.5 text-sm font-bold text-white"
        >
          Reload application
        </button>
      </section>
    );
  }
}
