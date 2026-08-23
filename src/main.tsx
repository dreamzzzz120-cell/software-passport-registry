import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './styles/spr-shell.css';

type BootstrapProps = { children: ReactNode };
type BootstrapState = { error: Error | null };

class BootstrapErrorBoundary extends Component<BootstrapProps, BootstrapState> {
  private readonly bootstrapChildren: ReactNode;

  constructor(props: BootstrapProps) {
    super(props);
    this.bootstrapChildren = props.children;
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BootstrapState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SPR Bootstrap Error]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: '#050914', color: '#e6eefc', fontFamily: 'Inter, system-ui, sans-serif' }}>
          <section style={{ width: 'min(680px, 100%)', padding: '28px', border: '1px solid rgba(255,255,255,.12)', borderRadius: '20px', background: 'rgba(12,18,35,.86)', boxShadow: '0 24px 80px rgba(0,0,0,.45)' }}>
            <div style={{ color: '#67e8f9', fontWeight: 800, letterSpacing: '.16em', fontSize: 12 }}>SOFTWARE PASSPORT REGISTRY</div>
            <h1 style={{ margin: '12px 0 8px', fontSize: 26 }}>Application startup failed</h1>
            <p style={{ color: '#94a3b8', lineHeight: 1.6 }}>SPR could not start the application. The failure is shown here instead of leaving a blank screen.</p>
            <pre style={{ marginTop: 18, padding: 16, overflow: 'auto', whiteSpace: 'pre-wrap', borderRadius: 12, background: '#020617', color: '#fca5a5', fontSize: 12 }}>{this.state.error.message || String(this.state.error)}</pre>
            <button type="button" onClick={() => window.location.reload()} style={{ marginTop: 18, padding: '11px 16px', border: 0, borderRadius: 10, background: 'linear-gradient(135deg,#67e8f9,#818cf8)', color: '#06101d', fontWeight: 800, cursor: 'pointer' }}>Reload application</button>
          </section>
        </main>
      );
    }
    return this.bootstrapChildren;
  }
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('SPR bootstrap failed: #root element is missing from index.html');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <BootstrapErrorBoundary>
      <App />
    </BootstrapErrorBoundary>
  </React.StrictMode>,
);
