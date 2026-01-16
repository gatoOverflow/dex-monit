import { MonitoringClient } from './monitoring-client.js';
import { Severity } from '@dex-monit/observability-contracts';

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

const CONSOLE_TO_SEVERITY: Record<ConsoleMethod, Severity> = {
  debug: 'debug',
  log: 'info',
  info: 'info',
  warn: 'warning',
  error: 'error',
};

interface OriginalConsoleMethods {
  log: typeof console.log;
  info: typeof console.info;
  warn: typeof console.warn;
  error: typeof console.error;
  debug: typeof console.debug;
}

let originalMethods: OriginalConsoleMethods | null = null;
let isCapturing = false;
let skipNestLogs = false;

/**
 * Start capturing console output and sending to monitoring
 * @param monitoringClient - The monitoring client to send logs to
 * @param options - Options for console capture
 * @param options.skipNestJsLogs - Skip logs that appear to come from NestJS Logger (to avoid duplicates)
 */
export function startConsoleCapture(
  monitoringClient: MonitoringClient,
  options: { skipNestJsLogs?: boolean } = {}
): void {
  if (isCapturing) {
    return;
  }

  skipNestLogs = options.skipNestJsLogs ?? false;

  // Store original methods
  originalMethods = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const methods: ConsoleMethod[] = ['log', 'info', 'warn', 'error', 'debug'];

  for (const method of methods) {
    const original = originalMethods[method];
    const severity = CONSOLE_TO_SEVERITY[method];

    console[method] = (...args: unknown[]) => {
      // Call original console method first
      original(...args);

      // Skip if it's our own SDK log to avoid infinite loops
      const message = formatConsoleArgs(args);
      if (shouldSkipLog(message)) {
        return;
      }

      // Send to monitoring (fire and forget)
      monitoringClient.captureLog(severity, message, {
        source: 'console',
        method,
      }).catch(() => {
        // Silently ignore - don't use console.error here to avoid loops
      });
    };
  }

  isCapturing = true;
}

/**
 * Check if a log message should be skipped
 */
function shouldSkipLog(message: string): boolean {
  // Skip SDK internal logs
  if (
    message.startsWith('[DEX SDK]') ||
    message.startsWith('[MonitoringClient]') ||
    message.startsWith('[RemoteLogger]')
  ) {
    return true;
  }

  // Skip NestJS Logger output if configured
  // NestJS Logger format: "[Nest] PID  - DATE     LEVEL [Context] Message"
  // or just colored output with ANSI codes
  if (skipNestLogs) {
    // Check for NestJS log patterns
    // Pattern 1: [Nest] prefix
    if (message.includes('[Nest]')) {
      return true;
    }
    // Pattern 2: ANSI color codes followed by LOG/WARN/ERROR/DEBUG
    if (/\x1b\[\d+m\s*(LOG|WARN|ERROR|DEBUG|VERBOSE)\s*\x1b/.test(message)) {
      return true;
    }
    // Pattern 3: Timestamp pattern from NestJS "MM/DD/YYYY, HH:MM:SS"
    if (/\d{1,2}\/\d{1,2}\/\d{4},\s+\d{1,2}:\d{2}:\d{2}\s+(AM|PM)?\s*(LOG|WARN|ERROR|DEBUG|VERBOSE)?/.test(message)) {
      return true;
    }
    // Pattern 4: Context in brackets [ContextName]
    if (/^\s*\[[\w-]+\]\s+/.test(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Stop capturing console output
 */
export function stopConsoleCapture(): void {
  if (!isCapturing || !originalMethods) {
    return;
  }

  console.log = originalMethods.log;
  console.info = originalMethods.info;
  console.warn = originalMethods.warn;
  console.error = originalMethods.error;
  console.debug = originalMethods.debug;

  originalMethods = null;
  isCapturing = false;
  skipNestLogs = false;
}

/**
 * Format console arguments into a single message string
 */
function formatConsoleArgs(args: unknown[]): string {
  return args.map(arg => {
    if (typeof arg === 'string') {
      return arg;
    }
    if (arg instanceof Error) {
      return `${arg.name}: ${arg.message}\n${arg.stack || ''}`;
    }
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }).join(' ');
}

/**
 * Check if console capture is active
 */
export function isConsoleCaptureActive(): boolean {
  return isCapturing;
}
