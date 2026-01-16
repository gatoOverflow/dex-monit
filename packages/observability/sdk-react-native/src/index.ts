// Main exports
export {
  init,
  captureException,
  captureMessage,
  captureLog,
  addBreadcrumb,
  setUser,
  setTag,
  setTags,
  setDeviceContext,
  close,
} from './lib/client';

export type {
  DexMonitoringConfig,
  UserContext,
  DeviceContext,
} from './lib/client';

// Error Boundary
export {
  DexErrorBoundary,
  withDexErrorBoundary,
} from './lib/error-boundary';

export type { ErrorBoundaryProps } from './lib/error-boundary';

// Hooks
export {
  useDexNavigation,
  useDexUser,
  useDexError,
  useDexCapture,
  useDexScreenView,
  useDexAction,
} from './lib/hooks';

// Re-export types from contracts
export type {
  ErrorEvent,
  LogEvent,
  Breadcrumb,
  StackFrame,
} from '@dex-monit/observability-contracts';

// Default export for convenience
import * as DexMonitoring from './lib/client';
export default DexMonitoring;
