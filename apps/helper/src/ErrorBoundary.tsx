import { Component, type ErrorInfo, type ReactNode } from 'react';

/** A screen that fails to draw must not leave a blank window: activation and the installation are
 * on disk, so reloading loses nothing. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="standalone" role="alert">
        <h1>This screen could not be shown</h1>
        <p>Your activation and your installation are safe. Reloading usually solves this.</p>
        <code className="code-chip">{this.state.error.message}</code>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}
