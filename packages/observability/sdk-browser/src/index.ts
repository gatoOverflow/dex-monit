// Core client exports
export {
  init,
  isInitialized,
  close,
  setUser,
  getUser,
  setTag,
  setTags,
  addBreadcrumb,
  clearBreadcrumbs,
  captureException,
  captureMessage,
  log,
  trackPageView,
  getSessionId,
} from './lib/client';

export type {
  DexBrowserConfig,
  UserContext,
  BrowserContext,
} from './lib/client';
