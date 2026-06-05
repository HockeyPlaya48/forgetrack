import { StrictMode, Component, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global error boundary — catches React render crashes and shows them on screen
// instead of a blank white page. Critical for mobile Safari debugging.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '24px', fontFamily: 'monospace', background: '#fff',
          color: '#c00', minHeight: '100vh', overflowY: 'auto'
        }}>
          <h2 style={{ marginBottom: 12 }}>ForgeTrack — App Error</h2>
          <p style={{ marginBottom: 8 }}>{this.state.error.message}</p>
          <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 16, padding: '10px 20px', background: '#c24a00',
              color: '#fff', border: 'none', borderRadius: 8, fontSize: 14,
              cursor: 'pointer'
            }}
          >
            Reload App
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Also catch raw JS errors before React mounts
window.onerror = (msg, _src, row, col, error) => {
  const root = document.getElementById('root');
  if (root && !root.hasChildNodes()) {
    root.innerHTML = `<div style="padding:24px;font-family:monospace;color:#c00;background:#fff;min-height:100vh">
      <h2>ForgeTrack — Startup Error</h2>
      <p>${msg}</p>
      <p style="font-size:11px">Line ${row}:${col}</p>
      <pre style="font-size:11px;white-space:pre-wrap;word-break:break-word">${error?.stack || ''}</pre>
      <button onclick="location.reload()" style="margin-top:16px;padding:10px 20px;background:#c24a00;color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer">Reload App</button>
    </div>`;
  }
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
