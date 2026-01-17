import type {
  ErrorEvent,
  LogEvent,
  Breadcrumb,
  StackFrame,
  Severity,
  DeviceContext as ContractDeviceContext,
} from '@dex-monit/observability-contracts';

export interface DexMonitoringConfig {
  /** API URL for the monitoring backend */
  apiUrl: string;
  /** API Key for authentication */
  apiKey: string;
  /** Project identifier */
  project?: string;
  /** Environment (e.g., 'production', 'staging', 'development') */
  environment?: string;
  /** App version */
  release?: string;
  /** Enable debug mode */
  debug?: boolean;
  /** Maximum breadcrumbs to keep */
  maxBreadcrumbs?: number;
  /** Sample rate for error reporting (0.0 - 1.0) */
  sampleRate?: number;
  /** Tags to add to all events */
  tags?: Record<string, string>;
  /** User information */
  user?: UserContext;
  /** Callback before sending event (return false to cancel) */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
}

export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

export interface DeviceContext {
  model?: string;
  brand?: string;
  systemName?: string;
  systemVersion?: string;
  appVersion?: string;
  buildNumber?: string;
  bundleId?: string;
  isTablet?: boolean;
  isEmulator?: boolean;
}

interface InternalState {
  initialized: boolean;
  config: DexMonitoringConfig | null;
  breadcrumbs: Breadcrumb[];
  user: UserContext | null;
  tags: Record<string, string>;
  device: DeviceContext | null;
  sessionId: string | null;
  currentScreen: string | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
}

const state: InternalState = {
  initialized: false,
  config: null,
  breadcrumbs: [],
  user: null,
  tags: {},
  device: null,
  sessionId: null,
  currentScreen: null,
  heartbeatInterval: null,
};

const SDK_NAME = '@dex-monit/observability-sdk-react-native';
const SDK_VERSION = '1.0.0';

/**
 * Initialize the Dex Monitoring SDK
 */
export function init(config: DexMonitoringConfig): void {
  if (state.initialized) {
    console.warn('[DexMonitoring] Already initialized');
    return;
  }

  state.config = {
    environment: 'production',
    project: 'default',
    maxBreadcrumbs: 100,
    sampleRate: 1.0,
    debug: false,
    ...config,
  };

  state.tags = config.tags || {};
  state.user = config.user || null;
  state.initialized = true;

  // Setup global error handlers
  setupGlobalErrorHandlers();

  // Try to get device info if React Native is available
  detectDeviceInfo();

  // Start a session
  startSession();

  if (state.config.debug) {
    console.log('[DexMonitoring] Initialized with config:', {
      apiUrl: state.config.apiUrl,
      environment: state.config.environment,
      release: state.config.release,
      sessionId: state.sessionId,
    });
  }
}

/**
 * Set user context and update current session
 */
export function setUser(user: UserContext | null): void {
  state.user = user;

  // Update session with new user info
  if (state.config && state.sessionId && user) {
    fetch(`${state.config.apiUrl}/sessions/identify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dex-Key': state.config.apiKey,
      },
      body: JSON.stringify({
        sessionId: state.sessionId,
        userId: user.id || user.email || user.username,
        userEmail: user.email,
        userName: user.username,
      }),
    }).catch((err) => {
      if (state.config?.debug) {
        console.warn('[DexMonitoring] Failed to identify user:', err);
      }
    });
  }
}

/**
 * Set a tag
 */
export function setTag(key: string, value: string): void {
  state.tags[key] = value;
}

/**
 * Set multiple tags
 */
export function setTags(tags: Record<string, string>): void {
  state.tags = { ...state.tags, ...tags };
}

/**
 * Add a breadcrumb
 */
export function addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
  const maxBreadcrumbs = state.config?.maxBreadcrumbs || 100;

  state.breadcrumbs.push({
    ...breadcrumb,
    timestamp: new Date().toISOString(),
  });

  // Keep only the last N breadcrumbs
  if (state.breadcrumbs.length > maxBreadcrumbs) {
    state.breadcrumbs = state.breadcrumbs.slice(-maxBreadcrumbs);
  }
}

/**
 * Convert uppercase level to Severity type
 */
function toSeverity(level: string): Severity {
  const map: Record<string, Severity> = {
    DEBUG: 'debug',
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    FATAL: 'fatal',
  };
  return map[level] || 'error';
}

/**
 * Convert local DeviceContext to contract DeviceContext
 */
function toContractDeviceContext(
  device: DeviceContext | null,
): ContractDeviceContext | undefined {
  if (!device) return undefined;
  return {
    arch: device.model,
    hostname: device.brand,
  };
}

/**
 * Capture an exception
 */
export async function captureException(
  error: Error | string,
  context?: Record<string, unknown>,
): Promise<string | null> {
  if (!state.initialized || !state.config) {
    console.warn('[DexMonitoring] Not initialized. Call init() first.');
    return null;
  }

  // Sample rate check
  if (Math.random() > (state.config.sampleRate || 1.0)) {
    return null;
  }

  const err = typeof error === 'string' ? new Error(error) : error;
  const eventId = generateEventId();

  const event: ErrorEvent = {
    eventId,
    timestamp: new Date().toISOString(),
    level: 'error',
    environment: state.config.environment || 'production',
    release: state.config.release,
    message: err.message,
    platform: 'react-native',
    project: state.config.project || 'default',
    sdk: {
      name: SDK_NAME,
      version: SDK_VERSION,
    },
    exception: {
      type: err.name || 'Error',
      value: err.message,
      stacktrace: parseStackTrace(err.stack),
    },
    breadcrumbs: [...state.breadcrumbs],
    contexts: {
      device: toContractDeviceContext(state.device),
      user: state.user
        ? {
            id: state.user.id,
            email: state.user.email,
            username: state.user.username,
          }
        : undefined,
      tags: { ...state.tags },
      extra: {
        ...context,
        deviceInfo: state.device,
      },
    },
  };

  // Call beforeSend hook
  if (state.config.beforeSend) {
    const modifiedEvent = state.config.beforeSend(event);
    if (!modifiedEvent) {
      if (state.config.debug) {
        console.log('[DexMonitoring] Event dropped by beforeSend');
      }
      return null;
    }
  }

  // Send to server
  await sendEvent(event);

  // Add breadcrumb for the error
  addBreadcrumb({
    type: 'error',
    category: 'exception',
    message: err.message,
    level: 'error',
  });

  return eventId;
}

/**
 * Capture a message
 */
export async function captureMessage(
  message: string,
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' = 'INFO',
  context?: Record<string, unknown>,
): Promise<string | null> {
  if (!state.initialized || !state.config) {
    console.warn('[DexMonitoring] Not initialized. Call init() first.');
    return null;
  }

  const eventId = generateEventId();

  const event: ErrorEvent = {
    eventId,
    timestamp: new Date().toISOString(),
    level: toSeverity(level),
    environment: state.config.environment || 'production',
    release: state.config.release,
    message,
    platform: 'react-native',
    project: state.config.project || 'default',
    sdk: {
      name: SDK_NAME,
      version: SDK_VERSION,
    },
    breadcrumbs: [...state.breadcrumbs],
    contexts: {
      device: toContractDeviceContext(state.device),
      user: state.user
        ? {
            id: state.user.id,
            email: state.user.email,
            username: state.user.username,
          }
        : undefined,
      tags: { ...state.tags },
      extra: {
        ...context,
        deviceInfo: state.device,
      },
    },
  };

  await sendEvent(event);
  return eventId;
}

/**
 * Capture a log
 */
export async function captureLog(
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR',
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!state.initialized || !state.config) {
    return;
  }

  const logEvent: LogEvent = {
    id: generateEventId(),
    timestamp: new Date().toISOString(),
    level: toSeverity(level),
    message,
    environment: state.config.environment || 'production',
    project: state.config.project || 'default',
    data,
    tags: { ...state.tags },
  };

  await sendLog(logEvent);
}

/**
 * Set device context manually (useful if auto-detection fails)
 */
export function setDeviceContext(device: DeviceContext): void {
  state.device = device;
}

/**
 * Get current session ID
 */
export function getSessionId(): string | null {
  return state.sessionId;
}

/**
 * Track a screen view
 */
export async function trackScreen(
  screenName: string,
  params?: Record<string, unknown>,
): Promise<void> {
  if (!state.initialized || !state.config) return;

  state.currentScreen = screenName;

  // Add breadcrumb
  addBreadcrumb({
    type: 'navigation',
    category: 'screen',
    message: screenName,
    data: params,
    level: 'info',
  });

  // Send page view to backend
  try {
    await fetch(`${state.config.apiUrl}/sessions/pageview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dex-Key': state.config.apiKey,
      },
      body: JSON.stringify({
        sessionId: state.sessionId,
        userId: state.user?.id,
        screenName,
        previousPage: state.currentScreen,
      }),
    });
  } catch {
    // Silent fail
  }

  if (state.config.debug) {
    console.log('[DexMonitoring] Screen tracked:', screenName);
  }
}

/**
 * Track a user action/interaction
 */
export function trackAction(
  action: string,
  category: string = 'ui.action',
  data?: Record<string, unknown>,
): void {
  addBreadcrumb({
    type: 'default',
    category,
    message: action,
    data,
    level: 'info',
  });
}

/**
 * Clear all data and reset SDK
 */
export function close(): void {
  // End session
  endSession();

  // Stop heartbeat
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }

  state.initialized = false;
  state.config = null;
  state.breadcrumbs = [];
  state.user = null;
  state.tags = {};
  state.device = null;
  state.sessionId = null;
  state.currentScreen = null;
}

// ============================================
// Session Management
// ============================================

function startSession(): void {
  if (!state.config) return;

  // Generate session ID
  state.sessionId = generateEventId();

  // Build session data with all available device info
  const sessionData = {
    sessionId: state.sessionId,
    userId: state.user?.id,
    platform: 'react-native',
    deviceType: state.device?.isTablet ? 'tablet' : 'phone',
    osName: state.device?.systemName,
    osVersion: state.device?.systemVersion,
    appVersion: state.device?.appVersion || state.config.release,
    // Additional device info
    deviceBrand: state.device?.brand,
    deviceModel: state.device?.model,
    bundleId: state.device?.bundleId,
    buildNumber: state.device?.buildNumber,
    isEmulator: state.device?.isEmulator,
  };

  // Send session start to backend
  fetch(`${state.config.apiUrl}/sessions/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dex-Key': state.config.apiKey,
    },
    body: JSON.stringify(sessionData),
  }).catch((err) => {
    if (state.config?.debug) {
      console.warn('[DexMonitoring] Failed to start session:', err);
    }
  });

  // Start heartbeat (every 30 seconds)
  state.heartbeatInterval = setInterval(() => {
    sendHeartbeat();
  }, 30000);

  if (state.config.debug) {
    console.log(
      '[DexMonitoring] Session started:',
      state.sessionId,
      sessionData,
    );
  }
}

function endSession(): void {
  if (!state.config || !state.sessionId) return;

  // Send session end to backend
  fetch(`${state.config.apiUrl}/sessions/end`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dex-Key': state.config.apiKey,
    },
    body: JSON.stringify({
      sessionId: state.sessionId,
    }),
  }).catch(() => {
    // Silent fail
  });

  if (state.config?.debug) {
    console.log('[DexMonitoring] Session ended:', state.sessionId);
  }
}

function sendHeartbeat(): void {
  if (!state.config || !state.sessionId) return;

  fetch(`${state.config.apiUrl}/sessions/heartbeat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dex-Key': state.config.apiKey,
    },
    body: JSON.stringify({
      sessionId: state.sessionId,
      currentPage: state.currentScreen,
    }),
  }).catch(() => {
    // Silent fail
  });
}

// ============================================
// Internal functions
// ============================================

function setupGlobalErrorHandlers(): void {
  // Handle JavaScript errors
  const originalHandler = ErrorUtils?.getGlobalHandler?.();

  ErrorUtils?.setGlobalHandler?.((error: Error, isFatal?: boolean) => {
    captureException(error, { isFatal });

    // Call original handler
    if (originalHandler) {
      originalHandler(error, isFatal);
    }
  });

  // Handle unhandled promise rejections
  const originalRejectionHandler = (global as Record<string, unknown>)
    .onunhandledrejection as ((event: { reason: unknown }) => void) | undefined;

  (global as Record<string, unknown>).onunhandledrejection = (event: {
    reason: unknown;
  }) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));

    captureException(error, { type: 'unhandledrejection' });

    if (originalRejectionHandler) {
      originalRejectionHandler(event);
    }
  };
}

function detectDeviceInfo(): void {
  try {
    // Try to import react-native dynamically
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RN = require('react-native');

    if (RN?.Platform) {
      state.device = {
        systemName: RN.Platform.OS,
        systemVersion: RN.Platform.Version?.toString(),
        isTablet: RN.Platform.isPad || false,
      };
    }

    // Try Expo Device API first (works without extra installation in Expo)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ExpoDevice = require('expo-device');

      state.device = {
        ...state.device,
        brand: ExpoDevice.brand,
        model: ExpoDevice.modelName || ExpoDevice.modelId,
        isTablet: ExpoDevice.deviceType === ExpoDevice.DeviceType?.TABLET,
        isEmulator: !ExpoDevice.isDevice,
      };

      if (state.config?.debug) {
        console.log(
          '[DexMonitoring] Device info from expo-device:',
          state.device,
        );
      }
    } catch {
      // expo-device not available, try react-native-device-info
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const DeviceInfo = require('react-native-device-info');

        state.device = {
          ...state.device,
          model: DeviceInfo.getModel?.(),
          brand: DeviceInfo.getBrand?.(),
          appVersion: DeviceInfo.getVersion?.(),
          buildNumber: DeviceInfo.getBuildNumber?.(),
          bundleId: DeviceInfo.getBundleId?.(),
          isEmulator: DeviceInfo.isEmulatorSync?.(),
        };

        if (state.config?.debug) {
          console.log(
            '[DexMonitoring] Device info from react-native-device-info:',
            state.device,
          );
        }
      } catch {
        // Neither library installed - use basic Platform info only
        if (state.config?.debug) {
          console.log(
            '[DexMonitoring] Using basic Platform info only. Install expo-device or react-native-device-info for better device detection.',
          );
        }
      }
    }
  } catch {
    // Not in React Native environment
    if (state.config?.debug) {
      console.log('[DexMonitoring] Not in React Native environment');
    }
  }
}

/**
 * Manually set device info (useful if auto-detection doesn't work)
 */
export function setDeviceInfo(device: Partial<DeviceContext>): void {
  state.device = { ...state.device, ...device };
}

function parseStackTrace(stack?: string): StackFrame[] {
  if (!stack) return [];

  const frames: StackFrame[] = [];
  const lines = stack.split('\n');

  for (const line of lines) {
    // Match patterns like:
    // "    at functionName (filename:line:column)"
    // "    at filename:line:column"
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?/);

    if (match) {
      const isInApp = !match[2].includes('node_modules');
      frames.push({
        function: match[1] || '<anonymous>',
        filename: match[2],
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
        // Add context hint for internal frames
        context: isInApp ? undefined : ['(external)'],
      });
    }
  }

  return frames;
}

function generateEventId(): string {
  // Generate a UUID-like string
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function sendEvent(event: ErrorEvent): Promise<void> {
  if (!state.config) return;

  try {
    const response = await fetch(`${state.config.apiUrl}/ingest/errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dex-Key': state.config.apiKey,
      },
      body: JSON.stringify(event),
    });

    if (!response.ok && state.config.debug) {
      console.warn('[DexMonitoring] Failed to send event:', response.status);
    }
  } catch (err) {
    if (state.config.debug) {
      console.warn('[DexMonitoring] Failed to send event:', err);
    }
  }
}

async function sendLog(log: LogEvent): Promise<void> {
  if (!state.config) return;

  try {
    await fetch(`${state.config.apiUrl}/ingest/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dex-Key': state.config.apiKey,
      },
      body: JSON.stringify(log),
    });
  } catch {
    // Silent fail for logs
  }
}

// Declare ErrorUtils for React Native
declare const ErrorUtils:
  | {
      getGlobalHandler?: () =>
        | ((error: Error, isFatal?: boolean) => void)
        | undefined;
      setGlobalHandler?: (
        handler: (error: Error, isFatal?: boolean) => void,
      ) => void;
    }
  | undefined;
