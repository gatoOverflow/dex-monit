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
  setDeviceInfo,
  getSessionId,
  trackScreen,
  trackAction,
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

// Offline Queue
export {
  initOfflineQueue,
  enqueue,
  getQueueSize,
  isOnline,
  flushQueue,
  clearQueue,
  closeOfflineQueue,
} from './lib/offline-queue';

export type { QueuedEvent, OfflineQueueConfig } from './lib/offline-queue';

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
