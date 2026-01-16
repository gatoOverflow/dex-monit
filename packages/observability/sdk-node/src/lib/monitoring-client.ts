import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import {
  ErrorEvent,
  EventContext,
  Severity,
  StackFrame,
  LogEvent,
  Breadcrumb,
} from '@dex-monit/observability-contracts';
import { RequestContextService } from '@dex-monit/observability-request-context';
import {
  scrubSensitiveData,
  ScrubberOptions,
} from '@dex-monit/observability-scrubber';

// Cache for source files to avoid re-reading
const sourceFileCache = new Map<string, string[] | null>();
const MAX_CACHE_SIZE = 100;

/**
 * Read source file and return lines array
 */
function readSourceFile(filename: string): string[] | null {
  // Check cache first
  if (sourceFileCache.has(filename)) {
    return sourceFileCache.get(filename) || null;
  }

  try {
    // Skip node_modules and non-local files
    if (
      filename.includes('node_modules') ||
      filename.startsWith('node:') ||
      !filename.startsWith('/')
    ) {
      return null;
    }

    // Check if file exists
    if (!fs.existsSync(filename)) {
      return null;
    }

    const content = fs.readFileSync(filename, 'utf-8');
    const lines = content.split('\n');

    // Manage cache size
    if (sourceFileCache.size >= MAX_CACHE_SIZE) {
      const firstKey = sourceFileCache.keys().next().value;
      if (firstKey) sourceFileCache.delete(firstKey);
    }

    sourceFileCache.set(filename, lines);
    return lines;
  } catch {
    sourceFileCache.set(filename, null);
    return null;
  }
}

/**
 * Get source code context around a specific line
 */
function getSourceContext(
  filename: string,
  lineno: number,
  contextLines = 5,
): string[] | undefined {
  const lines = readSourceFile(filename);
  if (!lines || lineno <= 0) return undefined;

  const start = Math.max(0, lineno - contextLines - 1);
  const end = Math.min(lines.length, lineno + contextLines);

  // Format lines with line numbers
  const context: string[] = [];
  for (let i = start; i < end; i++) {
    const lineNum = i + 1;
    const prefix = lineNum === lineno ? '>' : ' ';
    context.push(`${prefix} ${lineNum.toString().padStart(4)} | ${lines[i]}`);
  }

  return context;
}

// Global breadcrumb storage
const MAX_BREADCRUMBS = 100;
let globalBreadcrumbs: Breadcrumb[] = [];

/**
 * Monitoring client configuration
 */
export interface MonitoringClientConfig {
  /** URL of the monitoring API */
  apiUrl: string;
  /** API key for authentication */
  apiKey?: string;
  /** Project identifier */
  project: string;
  /** Environment name */
  environment?: string;
  /** Release/version identifier */
  release?: string;
  /** Server name */
  serverName?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Whether to enable the client */
  enabled?: boolean;
  /** Scrubber options for sensitive data */
  scrubberOptions?: ScrubberOptions;
  /** Before send hook - return null to drop the event */
  beforeSend?: (event: ErrorEvent) => ErrorEvent | null;
}

/**
 * Options for capturing exceptions
 */
export interface CaptureOptions {
  /** Additional context */
  context?: Partial<EventContext>;
  /** Custom fingerprint for grouping */
  fingerprint?: string[];
  /** Severity level override */
  level?: Severity;
  /** Tags */
  tags?: Record<string, string>;
  /** Extra data */
  extra?: Record<string, unknown>;
  /** Request context */
  request?: EventContext['request'];
  /** User context */
  user?: EventContext['user'];
}

/**
 * Parse stack trace into structured frames with source code context
 */
function parseStackTrace(stack?: string, includeContext = true): StackFrame[] {
  if (!stack) return [];

  const lines = stack.split('\n').slice(1); // Skip first line (error message)
  const frames: StackFrame[] = [];

  for (const line of lines) {
    const match = line.match(/at\s+(?:(.+?)\s+\()?(?:(.+?):(\d+):(\d+))\)?/);
    if (match) {
      const filename = match[2] || '<unknown>';
      const lineno = parseInt(match[3] || '0', 10);

      const frame: StackFrame = {
        function: match[1] || '<anonymous>',
        filename,
        lineno,
        colno: parseInt(match[4] || '0', 10),
      };

      // Add source code context for app frames (not node_modules)
      if (includeContext && !filename.includes('node_modules')) {
        const context = getSourceContext(filename, lineno, 5);
        if (context) {
          frame.context = context;
        }
      }

      frames.push(frame);
    }
  }

  return frames;
}

/**
 * Generate a fingerprint for error grouping
 */
function generateFingerprint(error: Error): string[] {
  const frames = parseStackTrace(error.stack);
  const topFrame = frames[0];

  return [
    error.name,
    error.message.substring(0, 100), // Limit message length
    topFrame?.filename || 'unknown',
    topFrame?.function || 'unknown',
  ];
}

/**
 * Monitoring Client
 *
 * Client for sending error events to the monitoring service.
 * Automatically captures request context and scrubs sensitive data.
 */
export class MonitoringClient {
  private config: Required<MonitoringClientConfig>;

  constructor(config: MonitoringClientConfig) {
    this.config = {
      apiUrl: config.apiUrl,
      apiKey: config.apiKey || process.env['DEX_API_KEY'] || '',
      project: config.project,
      environment:
        config.environment || process.env['NODE_ENV'] || 'development',
      release: config.release || process.env['APP_VERSION'] || 'unknown',
      serverName: config.serverName || process.env['HOSTNAME'] || 'unknown',
      timeout: config.timeout || 5000,
      enabled: config.enabled ?? true,
      scrubberOptions: config.scrubberOptions || {},
      beforeSend: config.beforeSend || ((event) => event),
    };
  }

  /**
   * Capture an exception and send to monitoring service
   */
  async captureException(
    error: Error,
    options: CaptureOptions = {},
  ): Promise<string | null> {
    if (!this.config.enabled) {
      return null;
    }

    const eventId = uuidv4();
    const requestContext = RequestContextService.get();

    // Build the error event
    let event: ErrorEvent = {
      eventId,
      timestamp: new Date().toISOString(),
      level: options.level || 'error',
      platform: 'node',
      sdk: {
        name: '@dex-monit/observability-sdk-node',
        version: '1.0.0',
      },
      project: this.config.project,
      environment: this.config.environment,
      serverName: this.config.serverName,
      release: this.config.release,
      message: error.message,
      exception: {
        type: error.name,
        value: error.message,
        stacktrace: parseStackTrace(error.stack),
      },
      // Include breadcrumbs (events leading up to the error)
      breadcrumbs: getBreadcrumbs(),
      requestId: requestContext?.requestId,
      transactionId: requestContext?.transactionId,
      fingerprint: options.fingerprint || generateFingerprint(error),
      contexts: {
        runtime: {
          name: 'node',
          version: process.version,
        },
        request: options.request,
        user: options.user,
        tags: options.tags,
        extra: options.extra,
        ...options.context,
      },
    };

    // Scrub sensitive data
    event = scrubSensitiveData(event, this.config.scrubberOptions);

    // Run beforeSend hook
    const processedEvent = this.config.beforeSend(event);
    if (!processedEvent) {
      return null;
    }

    // Send to monitoring service
    try {
      await this.sendEvent(processedEvent);
      return eventId;
    } catch (sendError) {
      // Silently fail - we don't want monitoring to break the app
      console.error('[MonitoringClient] Failed to send event:', sendError);
      return null;
    }
  }

  /**
   * Capture a message as an event
   */
  async captureMessage(
    message: string,
    level: Severity = 'info',
    options: Omit<CaptureOptions, 'level'> = {},
  ): Promise<string | null> {
    if (!this.config.enabled) {
      return null;
    }

    const eventId = uuidv4();
    const requestContext = RequestContextService.get();

    let event: ErrorEvent = {
      eventId,
      timestamp: new Date().toISOString(),
      level,
      platform: 'node',
      sdk: {
        name: '@dex-monit/observability-sdk-node',
        version: '1.0.0',
      },
      project: this.config.project,
      environment: this.config.environment,
      serverName: this.config.serverName,
      release: this.config.release,
      message,
      requestId: requestContext?.requestId,
      transactionId: requestContext?.transactionId,
      fingerprint: options.fingerprint || [message.substring(0, 100)],
      contexts: {
        runtime: {
          name: 'node',
          version: process.version,
        },
        request: options.request,
        user: options.user,
        tags: options.tags,
        extra: options.extra,
        ...options.context,
      },
    };

    // Scrub sensitive data
    event = scrubSensitiveData(event, this.config.scrubberOptions);

    // Run beforeSend hook
    const processedEvent = this.config.beforeSend(event);
    if (!processedEvent) {
      return null;
    }

    try {
      await this.sendEvent(processedEvent);
      return eventId;
    } catch (sendError) {
      console.error('[MonitoringClient] Failed to send event:', sendError);
      return null;
    }
  }

  /**
   * Capture a single log entry and send to monitoring service
   */
  async captureLog(
    level: Severity,
    message: string,
    data?: Record<string, unknown>,
    tags?: Record<string, string>,
  ): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const requestContext = RequestContextService.get();

    const logEvent: LogEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      level,
      message,
      project: this.config.project,
      environment: this.config.environment,
      serverName: this.config.serverName,
      requestId: requestContext?.requestId,
      transactionId: requestContext?.transactionId,
      data: data
        ? scrubSensitiveData(data, this.config.scrubberOptions)
        : undefined,
      tags,
    };

    try {
      await this.sendLog(logEvent);
    } catch (err) {
      // Silently fail - don't break the app for logging issues
      console.error('[MonitoringClient] Failed to send log:', err);
    }
  }

  /**
   * Capture multiple log entries in batch
   */
  async captureLogs(
    logs: Array<{
      level: Severity;
      message: string;
      data?: Record<string, unknown>;
      tags?: Record<string, string>;
      timestamp?: string;
    }>,
  ): Promise<void> {
    if (!this.config.enabled || logs.length === 0) {
      return;
    }

    const requestContext = RequestContextService.get();

    const logEvents: LogEvent[] = logs.map((log) => ({
      id: uuidv4(),
      timestamp: log.timestamp || new Date().toISOString(),
      level: log.level,
      message: log.message,
      project: this.config.project,
      environment: this.config.environment,
      serverName: this.config.serverName,
      requestId: requestContext?.requestId,
      transactionId: requestContext?.transactionId,
      data: log.data
        ? scrubSensitiveData(log.data, this.config.scrubberOptions)
        : undefined,
      tags: log.tags,
    }));

    try {
      await this.sendLogsBatch(logEvents);
    } catch (err) {
      console.error('[MonitoringClient] Failed to send logs batch:', err);
    }
  }

  /**
   * Send event to monitoring API
   */
  private async sendEvent(event: ErrorEvent): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add API key authentication if provided
    if (this.config.apiKey) {
      headers['X-Dex-Key'] = this.config.apiKey;
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/ingest/errors`, {
        method: 'POST',
        headers,
        body: JSON.stringify(event),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send single log to monitoring API
   */
  private async sendLog(log: LogEvent): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-Dex-Key'] = this.config.apiKey;
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/ingest/logs`, {
        method: 'POST',
        headers,
        body: JSON.stringify(log),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Send logs batch to monitoring API
   */
  private async sendLogsBatch(logs: LogEvent[]): Promise<void> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-Dex-Key'] = this.config.apiKey;
    }

    try {
      const response = await fetch(`${this.config.apiUrl}/ingest/logs/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ logs }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if the client is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Get the configured project
   */
  getProject(): string {
    return this.config.project;
  }

  /**
   * Get the client configuration (for HTTP trace sending)
   */
  getConfig(): { apiUrl: string; apiKey: string; project: string } {
    return {
      apiUrl: this.config.apiUrl,
      apiKey: this.config.apiKey,
      project: this.config.project,
    };
  }
}

/**
 * Create a monitoring client instance
 */
export function createMonitoringClient(
  config: MonitoringClientConfig,
): MonitoringClient {
  return new MonitoringClient(config);
}

/**
 * Add a breadcrumb to the global breadcrumb trail
 */
export function addBreadcrumb(breadcrumb: Omit<Breadcrumb, 'timestamp'>): void {
  const crumb: Breadcrumb = {
    timestamp: new Date().toISOString(),
    ...breadcrumb,
  };

  globalBreadcrumbs.push(crumb);

  // Keep only the last MAX_BREADCRUMBS
  if (globalBreadcrumbs.length > MAX_BREADCRUMBS) {
    globalBreadcrumbs = globalBreadcrumbs.slice(-MAX_BREADCRUMBS);
  }
}

/**
 * Get current breadcrumbs
 */
export function getBreadcrumbs(): Breadcrumb[] {
  return [...globalBreadcrumbs];
}

/**
 * Clear all breadcrumbs
 */
export function clearBreadcrumbs(): void {
  globalBreadcrumbs = [];
}

/**
 * Add an HTTP breadcrumb (convenience function)
 */
export function addHttpBreadcrumb(data: {
  url: string;
  method: string;
  statusCode?: number;
  duration?: number;
}): void {
  addBreadcrumb({
    category: 'http',
    type: 'http',
    level: data.statusCode && data.statusCode >= 400 ? 'error' : 'info',
    message: `${data.method} ${data.url}`,
    data: {
      url: data.url,
      method: data.method,
      status_code: data.statusCode,
      duration_ms: data.duration,
    },
  });
}

/**
 * Add a console breadcrumb (convenience function)
 */
export function addConsoleBreadcrumb(
  level: Severity,
  message: string,
  data?: Record<string, unknown>,
): void {
  addBreadcrumb({
    category: 'console',
    type: 'debug',
    level,
    message,
    data,
  });
}
