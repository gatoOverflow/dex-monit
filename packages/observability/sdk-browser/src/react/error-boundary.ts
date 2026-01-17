'use client';

import { Component, createElement, ReactNode, ErrorInfo } from 'react';
import { captureException, addBreadcrumb } from '../lib/client';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  beforeCapture?: (error: Error) => Record<string, unknown> | void;
  showDialog?: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary that automatically captures errors to Dex Monitoring
 */
export class DexErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Get additional context from beforeCapture
    const extraContext = this.props.beforeCapture?.(error);

    // Add breadcrumb
    addBreadcrumb({
      category: 'error.boundary',
      message: `Error caught by boundary: ${error.message}`,
      level: 'error',
      data: {
        componentStack: errorInfo.componentStack,
      },
    });

    // Capture the error
    captureException(error, {
      type: 'react_error_boundary',
      componentStack: errorInfo.componentStack,
      ...extraContext,
    });

    // Call custom error handler
    this.props.onError?.(error, errorInfo);
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Custom fallback
      if (this.props.fallback) {
        if (typeof this.props.fallback === 'function') {
          return this.props.fallback(this.state.error, this.reset);
        }
        return this.props.fallback;
      }

      // Default fallback
      return createElement(
        'div',
        {
          style: {
            padding: '20px',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          },
        },
        createElement('h2', null, 'Something went wrong'),
        createElement(
          'p',
          { style: { color: '#666' } },
          'An error occurred. Our team has been notified.',
        ),
        createElement(
          'button',
          {
            onClick: this.reset,
            style: {
              padding: '10px 20px',
              marginTop: '10px',
              cursor: 'pointer',
              backgroundColor: '#0070f3',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
            },
          },
          'Try Again',
        ),
      );
    }

    return this.props.children;
  }
}

/**
 * HOC to wrap a component with error boundary
 */
export function withDexErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>,
): React.FC<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const WithErrorBoundary: React.FC<P> = (props: P) => {
    return createElement(
      DexErrorBoundary,
      { ...errorBoundaryProps, children: createElement(WrappedComponent, props) } as ErrorBoundaryProps,
    );
  };

  WithErrorBoundary.displayName = `withDexErrorBoundary(${displayName})`;

  return WithErrorBoundary;
}
