import React, { Component, ReactNode, ErrorInfo } from 'react';
import { captureException, addBreadcrumb } from './client';

export interface ErrorBoundaryProps {
  /** Children to render */
  children: ReactNode;
  /** Fallback UI to show when error occurs */
  fallback?: ReactNode | ((error: Error, eventId: string | null) => ReactNode);
  /** Called when an error is caught */
  onError?: (error: Error, errorInfo: ErrorInfo, eventId: string | null) => void;
  /** Additional context to send with the error */
  context?: Record<string, unknown>;
  /** Tags to add to the error event */
  tags?: Record<string, string>;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  eventId: string | null;
}

/**
 * Error Boundary component that captures React errors
 * 
 * @example
 * ```tsx
 * <DexErrorBoundary
 *   fallback={<Text>Something went wrong</Text>}
 *   onError={(error, errorInfo, eventId) => {
 *     console.log('Error captured:', eventId);
 *   }}
 * >
 *   <MyApp />
 * </DexErrorBoundary>
 * ```
 */
export class DexErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      eventId: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override async componentDidCatch(error: Error, errorInfo: ErrorInfo): Promise<void> {
    // Add breadcrumb
    addBreadcrumb({
      type: 'error',
      category: 'react.error-boundary',
      message: error.message,
      level: 'error',
      data: {
        componentStack: errorInfo.componentStack,
      },
    });

    // Capture the exception
    const eventId = await captureException(error, {
      componentStack: errorInfo.componentStack,
      ...this.props.context,
      ...this.props.tags,
    });

    this.setState({ eventId });

    // Call onError callback
    if (this.props.onError) {
      this.props.onError(error, errorInfo, eventId);
    }
  }

  override render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      // Render fallback UI
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error, this.state.eventId);
      }

      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default fallback
      return null;
    }

    return this.props.children;
  }
}

/**
 * HOC to wrap a component with error boundary
 * 
 * @example
 * ```tsx
 * const SafeMyComponent = withDexErrorBoundary(MyComponent, {
 *   fallback: <Text>Error loading component</Text>
 * });
 * ```
 */
export function withDexErrorBoundary<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
): React.ComponentType<P> {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';

  const ComponentWithErrorBoundary: React.FC<P> = (props) => {
    return (
      <DexErrorBoundary {...errorBoundaryProps}>
        <WrappedComponent {...props} />
      </DexErrorBoundary>
    );
  };

  ComponentWithErrorBoundary.displayName = `withDexErrorBoundary(${displayName})`;

  return ComponentWithErrorBoundary;
}
