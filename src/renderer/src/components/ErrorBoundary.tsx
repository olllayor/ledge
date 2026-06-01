import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <main className="loading-shell">
          <div className="loading-card">
            <p className="eyebrow">Something went wrong</p>
            <p>{this.state.error?.message || 'An unexpected error occurred.'}</p>
            <button
              className="ghost-button"
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{ marginTop: '12px' }}
            >
              Try Again
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
