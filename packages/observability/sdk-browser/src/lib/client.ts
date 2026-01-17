import type {
  ErrorEvent,
  LogEvent,
  Breadcrumb,
  StackFrame,
  Severity,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface DexBrowserConfig {
  apiKey: string;
  apiUrl: string;
  environment?: string;
  release?: string;
  debug?: boolean;
  sampleRate?: number;
  maxBreadcrumbs?: number;
  captureConsole?: boolean;
  captureUnhandledRejections?: boolean;
  captureGlobalErrors?: boolean;
  sessionTracking?: boolean;
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
}

export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

export interface BrowserContext {
  url: string;
  referrer: string;
  userAgent: string;
  language: string;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  colorDepth: number;
  pixelRatio: number;
  timezone: string;
  cookiesEnabled: boolean;
}

type ErrorHandler = typeof window.onerror;
type RejectionHandler = (event: PromiseRejectionEvent) => void;

interface DexState {
  initialized: boolean;
  config: DexBrowserConfig | null;
  user: UserContext | null;
  tags: Record<string, string>;
  breadcrumbs: Breadcrumb[];
  sessionId: string | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
  originalConsole: Partial<Console> | null;
  originalOnError: ErrorHandler | null;
  originalOnUnhandledRejection: RejectionHandler | null;
}

// ============================================================================
// State
// ============================================================================

const state: DexState = {
  initialized: false,
  config: null,
  user: null,
  tags: {},
  breadcrumbs: [],
  sessionId: null,
  heartbeatInterval: null,
  originalConsole: null,
  originalOnError: null,
  originalOnUnhandledRejection: null,
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Initialize the Dex Browser SDK
 */
export function init(config: DexBrowserConfig): void {
  if (state.initialized) {
    console.warn('[DexMonitoring] Already initialized');
    return;
  }

  // Validate required fields
  if (!config.apiKey) {
    console.error('[DexMonitoring] apiKey is required');
    return;
  }
  if (!config.apiUrl) {
    console.error('[DexMonitoring] apiUrl is required');
    return;
  }

  state.config = {
    sampleRate: 1.0,
    maxBreadcrumbs: 100,
    captureConsole: true,
    captureUnhandledRejections: true,
    captureGlobalErrors: true,
    sessionTracking: true,
    ...config,
  };

  state.initialized = true;

  // Setup error handlers (browser only)
  if (typeof window !== 'undefined') {
    if (state.config.captureGlobalErrors) {
      setupGlobalErrorHandler();
    }
    if (state.config.captureUnhandledRejections) {
      setupUnhandledRejectionHandler();
    }
    if (state.config.captureConsole) {
      setupConsoleCapture();
    }
    if (state.config.sessionTracking) {
      startSession();
    }
  }

  if (state.config.debug) {
    console.log('[DexMonitoring] Browser SDK initialized', {
      apiUrl: state.config.apiUrl,
      environment: state.config.environment,
      sessionId: state.sessionId,
    });
  }
}

/**
 * Check if SDK is initialized
 */
export function isInitialized(): boolean {
  return state.initialized;
}

/**
 * Get current session ID
 */
export function getSessionId(): string | null {
  return state.sessionId;
}

/**
 * Set user context
 */
export function setUser(user: UserContext | null): void {
  state.user = user;

  // Update session with user info
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
 * Get current user
 */
export function getUser(): UserContext | null {
  return state.user;
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
  if (!state.config) return;

  const fullBreadcrumb: Breadcrumb = {
    ...breadcrumb,
    timestamp: new Date().toISOString(),
  };

  state.breadcrumbs.push(fullBreadcrumb);

  // Trim to max breadcrumbs
  if (state.breadcrumbs.length > (state.config.maxBreadcrumbs || 100)) {
    state.breadcrumbs = state.breadcrumbs.slice(-state.config.maxBreadcrumbs!);
  }
}

/**
 * Clear breadcrumbs
 */
export function clearBreadcrumbs(): void {
  state.breadcrumbs = [];
}

// ============================================================================
// Error Capturing
// ============================================================================

/**
 * Capture an exception
 */
export async function captureException(
  error: Error | string,
  context?: Record<string, unknown>,
): Promise<string | null> {
  if (!state.initialized || !state.config) {
    console.warn('[DexMonitoring] SDK not initialized');
    return null;
  }

  // Sample rate check
  if (Math.random() > (state.config.sampleRate || 1.0)) {
    return null;
  }

  const errorObj = typeof error === 'string' ? new Error(error) : error;
  const eventId = generateEventId();

  // Parse stack trace
  const stackFrames = parseStackTrace(errorObj);

  const event: ErrorEvent = {
    eventId,
    timestamp: new Date().toISOString(),
    platform: 'browser',
    level: 'error' as Severity,
    message: errorObj.message,
    exception: {
      type: errorObj.name || 'Error',
      value: errorObj.message,
      stacktrace: stackFrames,
    },
    tags: { ...state.tags },
    breadcrumbs: [...state.breadcrumbs],
    contexts: {
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
        browser: getBrowserContext(),
      },
    },
    environment: state.config.environment || 'production',
    release: state.config.release,
    request:
      typeof window !== 'undefined'
        ? {
            url: window.location.href,
            method: 'GET',
            headers: {},
          }
        : undefined,
    user: state.user || undefined,
    fingerprint: generateFingerprint(errorObj),
    sessionId: state.sessionId || undefined,
  };

  // Apply beforeSend hook
  const processedEvent = state.config.beforeSend
    ? state.config.beforeSend(event)
    : event;

  if (!processedEvent) {
    if (state.config.debug) {
      console.log('[DexMonitoring] Event dropped by beforeSend');
    }
    return null;
  }

  // Send to backend
  try {
    await fetch(`${state.config.apiUrl}/ingest/errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dex-Key': state.config.apiKey,
      },
      body: JSON.stringify(processedEvent),
    });

    if (state.config.debug) {
      console.log('[DexMonitoring] Error captured:', eventId);
    }

    // Add breadcrumb for the captured error
    addBreadcrumb({
      category: 'error',
      message: errorObj.message,
      level: 'error',
      data: { eventId },
    });

    return eventId;
  } catch (err) {
    if (state.config.debug) {
      console.error('[DexMonitoring] Failed to send error:', err);
    }
    return null;
  }
}

/**
 * Capture a message
 */
export async function captureMessage(
  message: string,
  level: 'debug' | 'info' | 'warning' | 'error' = 'info',
  context?: Record<string, unknown>,
): Promise<string | null> {
  if (!state.initialized || !state.config) {
    return null;
  }

  const eventId = generateEventId();

  const event: ErrorEvent = {
    eventId,
    timestamp: new Date().toISOString(),
    platform: 'browser',
    level: level as Severity,
    message,
    tags: { ...state.tags },
    breadcrumbs: [...state.breadcrumbs],
    contexts: {
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
        browser: getBrowserContext(),
      },
    },
    environment: state.config.environment || 'production',
    release: state.config.release,
    user: state.user || undefined,
    fingerprint: [message],
    sessionId: state.sessionId || undefined,
  };

  try {
    await fetch(`${state.config.apiUrl}/ingest/errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dex-Key': state.config.apiKey,
      },
      body: JSON.stringify(event),
    });

    return eventId;
  } catch {
    return null;
  }
}

// ============================================================================
// Log Capturing
// ============================================================================

/**
 * Send a log message
 */
export async function log(
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR',
  message: string,
  data?: Record<string, unknown>,
): Promise<void> {
  if (!state.initialized || !state.config) return;

  const logEvent: LogEvent = {
    timestamp: new Date().toISOString(),
    level,
    message,
    context: {
      ...data,
      url: typeof window !== 'undefined' ? window.location.href : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    },
    tags: { ...state.tags },
    environment: state.config.environment || 'production',
    release: state.config.release,
    sessionId: state.sessionId || undefined,
  };

  try {
    await fetch(`${state.config.apiUrl}/ingest/logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dex-Key': state.config.apiKey,
      },
      body: JSON.stringify(logEvent),
    });
  } catch {
    // Silently fail
  }
}

// ============================================================================
// Session Tracking
// ============================================================================

/**
 * Start a new session
 */
function startSession(): void {
  // Try to restore session from storage
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const existingSessionId = sessionStorage.getItem('dex_session_id');
    if (existingSessionId) {
      state.sessionId = existingSessionId;
      sendHeartbeat();
      startHeartbeatInterval();
      return;
    }
  }

  // Create new session
  state.sessionId = generateSessionId();

  if (typeof window !== 'undefined' && window.sessionStorage) {
    sessionStorage.setItem('dex_session_id', state.sessionId);
  }

  const sessionData = {
    sessionId: state.sessionId,
    platform: 'browser',
    deviceType: getDeviceType(),
    osName: getOSName(),
    osVersion: getOSVersion(),
    browser: getBrowserName(),
    browserVersion: getBrowserVersion(),
    entryPage: typeof window !== 'undefined' ? window.location.pathname : undefined,
    referrer: typeof document !== 'undefined' ? document.referrer : undefined,
    screenWidth: typeof screen !== 'undefined' ? screen.width : undefined,
    screenHeight: typeof screen !== 'undefined' ? screen.height : undefined,
    language: typeof navigator !== 'undefined' ? navigator.language : undefined,
  };

  // Send session start
  if (state.config) {
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
  }

  startHeartbeatInterval();

  // Track page visibility changes
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
  }

  if (state.config?.debug) {
    console.log('[DexMonitoring] Session started:', state.sessionId);
  }
}

function startHeartbeatInterval(): void {
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
  }
  state.heartbeatInterval = setInterval(sendHeartbeat, 30000);
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
      currentPage: typeof window !== 'undefined' ? window.location.pathname : undefined,
    }),
  }).catch(() => {
    // Silently fail
  });
}

function handleVisibilityChange(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    sendHeartbeat();
  }
}

function handleBeforeUnload(): void {
  if (!state.config || !state.sessionId) return;

  // Use sendBeacon for reliable delivery
  const data = JSON.stringify({
    sessionId: state.sessionId,
    exitPage: typeof window !== 'undefined' ? window.location.pathname : undefined,
  });

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    navigator.sendBeacon(
      `${state.config.apiUrl}/sessions/end`,
      new Blob([data], { type: 'application/json' }),
    );
  }
}

/**
 * Track a page view
 */
export function trackPageView(pagePath?: string, pageTitle?: string): void {
  if (!state.config || !state.sessionId) return;

  const path = pagePath || (typeof window !== 'undefined' ? window.location.pathname : '/');
  const title = pageTitle || (typeof document !== 'undefined' ? document.title : '');

  fetch(`${state.config.apiUrl}/sessions/pageview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Dex-Key': state.config.apiKey,
    },
    body: JSON.stringify({
      sessionId: state.sessionId,
      pagePath: path,
      pageTitle: title,
      referrer: typeof document !== 'undefined' ? document.referrer : undefined,
    }),
  }).catch(() => {
    // Silently fail
  });

  // Add navigation breadcrumb
  addBreadcrumb({
    category: 'navigation',
    message: `Navigated to ${path}`,
    data: { to: path },
  });
}

// ============================================================================
// Error Handlers Setup
// ============================================================================

function setupGlobalErrorHandler(): void {
  if (typeof window === 'undefined') return;

  state.originalOnError = window.onerror;

  window.onerror = (
    message: string | Event,
    source?: string,
    lineno?: number,
    colno?: number,
    error?: Error,
  ) => {
    const errorObj = error || new Error(String(message));

    captureException(errorObj, {
      type: 'global_error',
      source,
      lineno,
      colno,
    });

    // Call original handler if exists
    if (state.originalOnError) {
      return (state.originalOnError as (
        message: string | Event,
        source?: string,
        lineno?: number,
        colno?: number,
        error?: Error,
      ) => boolean | void)(message, source, lineno, colno, error);
    }
    return false;
  };
}

function setupUnhandledRejectionHandler(): void {
  if (typeof window === 'undefined') return;

  state.originalOnUnhandledRejection = window.onunhandledrejection as RejectionHandler | null;

  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));

    captureException(error, { type: 'unhandled_rejection' });

    // Call original handler if exists
    if (state.originalOnUnhandledRejection) {
      state.originalOnUnhandledRejection(event);
    }
  };
}

function setupConsoleCapture(): void {
  if (typeof console === 'undefined') return;

  state.originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  const wrapConsole = (
    method: 'log' | 'warn' | 'error' | 'info' | 'debug',
    level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR',
  ) => {
    const original = state.originalConsole?.[method];
    if (!original) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any)[method] = (...args: unknown[]) => {
      // Call original
      original.apply(console, args);

      // Skip our own logs
      const message = args.map((a) => String(a)).join(' ');
      if (message.includes('[DexMonitoring]')) return;

      // Add breadcrumb
      addBreadcrumb({
        category: 'console',
        message,
        level: level.toLowerCase() as Breadcrumb['level'],
      });

      // Send errors to backend
      if (method === 'error') {
        log(level, message, { source: 'console' });
      }
    };
  };

  wrapConsole('error', 'ERROR');
  wrapConsole('warn', 'WARNING');
  wrapConsole('info', 'INFO');
  wrapConsole('log', 'INFO');
  wrapConsole('debug', 'DEBUG');
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Close the SDK and cleanup
 */
export function close(): void {
  if (!state.initialized) return;

  // Stop heartbeat
  if (state.heartbeatInterval) {
    clearInterval(state.heartbeatInterval);
    state.heartbeatInterval = null;
  }

  // Restore original error handlers
  if (typeof window !== 'undefined') {
    if (state.originalOnError !== null) {
      window.onerror = state.originalOnError as typeof window.onerror;
    }
    if (state.originalOnUnhandledRejection !== null) {
      window.onunhandledrejection = state.originalOnUnhandledRejection as typeof window.onunhandledrejection;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    }
  }

  // Restore console
  if (state.originalConsole) {
    Object.assign(console, state.originalConsole);
  }

  state.initialized = false;
  state.config = null;
  state.sessionId = null;

  if (typeof window !== 'undefined' && window.sessionStorage) {
    sessionStorage.removeItem('dex_session_id');
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

function generateEventId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function parseStackTrace(error: Error): StackFrame[] {
  const stack = error.stack || '';
  const frames: StackFrame[] = [];

  const lines = stack.split('\n');

  for (const line of lines) {
    // Chrome/Safari format: "    at functionName (file:line:col)"
    const chromeMatch = line.match(/^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
    if (chromeMatch) {
      frames.push({
        function: chromeMatch[1] || '<anonymous>',
        filename: chromeMatch[2],
        lineno: parseInt(chromeMatch[3], 10),
        colno: parseInt(chromeMatch[4], 10),
      });
      continue;
    }

    // Firefox format: "functionName@file:line:col"
    const firefoxMatch = line.match(/^(.+?)@(.+?):(\d+):(\d+)$/);
    if (firefoxMatch) {
      frames.push({
        function: firefoxMatch[1] || '<anonymous>',
        filename: firefoxMatch[2],
        lineno: parseInt(firefoxMatch[3], 10),
        colno: parseInt(firefoxMatch[4], 10),
      });
    }
  }

  return frames.reverse(); // Most recent frame first
}

function generateFingerprint(error: Error): string[] {
  return [error.name, error.message.split('\n')[0]];
}

function getBrowserContext(): BrowserContext | undefined {
  if (typeof window === 'undefined') return undefined;

  return {
    url: window.location.href,
    referrer: document.referrer,
    userAgent: navigator.userAgent,
    language: navigator.language,
    screenWidth: screen.width,
    screenHeight: screen.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cookiesEnabled: navigator.cookieEnabled,
  };
}

function getDeviceType(): string {
  if (typeof navigator === 'undefined') return 'unknown';

  const ua = navigator.userAgent.toLowerCase();
  if (/tablet|ipad|playbook|silk/i.test(ua)) return 'tablet';
  if (/mobile|iphone|ipod|android|blackberry|opera mini|iemobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function getOSName(): string {
  if (typeof navigator === 'undefined') return 'unknown';

  const ua = navigator.userAgent;
  if (ua.includes('Windows')) return 'Windows';
  if (ua.includes('Mac OS')) return 'macOS';
  if (ua.includes('Linux')) return 'Linux';
  if (ua.includes('Android')) return 'Android';
  if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
  return 'unknown';
}

function getOSVersion(): string {
  if (typeof navigator === 'undefined') return '';

  const ua = navigator.userAgent;

  // Windows
  const windowsMatch = ua.match(/Windows NT (\d+\.\d+)/);
  if (windowsMatch) {
    const versions: Record<string, string> = {
      '10.0': '10/11',
      '6.3': '8.1',
      '6.2': '8',
      '6.1': '7',
    };
    return versions[windowsMatch[1]] || windowsMatch[1];
  }

  // macOS
  const macMatch = ua.match(/Mac OS X (\d+[._]\d+[._]?\d*)/);
  if (macMatch) return macMatch[1].replace(/_/g, '.');

  // Android
  const androidMatch = ua.match(/Android (\d+(\.\d+)?)/);
  if (androidMatch) return androidMatch[1];

  // iOS
  const iosMatch = ua.match(/OS (\d+[._]\d+[._]?\d*)/);
  if (iosMatch) return iosMatch[1].replace(/_/g, '.');

  return '';
}

function getBrowserName(): string {
  if (typeof navigator === 'undefined') return 'unknown';

  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Edg')) return 'Edge';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Safari')) return 'Safari';
  if (ua.includes('Opera')) return 'Opera';
  return 'unknown';
}

function getBrowserVersion(): string {
  if (typeof navigator === 'undefined') return '';

  const ua = navigator.userAgent;
  let match: RegExpMatchArray | null;

  if ((match = ua.match(/Firefox\/(\d+(\.\d+)?)/))) return match[1];
  if ((match = ua.match(/Edg\/(\d+(\.\d+)?)/))) return match[1];
  if ((match = ua.match(/Chrome\/(\d+(\.\d+)?)/))) return match[1];
  if ((match = ua.match(/Version\/(\d+(\.\d+)?)/))) return match[1]; // Safari
  if ((match = ua.match(/Opera\/(\d+(\.\d+)?)/))) return match[1];

  return '';
}
