import { Logger, LogContext, LoggerConfig } from '@dex-monit/observability-logger';
import { MonitoringClient } from './monitoring-client.js';
import { Severity } from '@dex-monit/observability-contracts';

/**
 * Configuration for remote logger
 */
export interface RemoteLoggerConfig extends LoggerConfig {
  /** Monitoring client for remote log capture */
  monitoringClient?: MonitoringClient;
  /** Minimum level to send remotely (default: 'info') */
  remoteLevel?: Severity;
  /** Whether to buffer logs and send in batches (default: true) */
  bufferLogs?: boolean;
  /** Buffer flush interval in ms (default: 5000) */
  flushInterval?: number;
  /** Maximum buffer size before auto-flush (default: 100) */
  maxBufferSize?: number;
}

interface BufferedLog {
  level: Severity;
  message: string;
  data?: Record<string, unknown>;
  tags?: Record<string, string>;
  timestamp: string;
}

const LEVEL_PRIORITY: Record<Severity, number> = {
  debug: 0,
  info: 1,
  warning: 2,
  error: 3,
  fatal: 4,
};

/**
 * Remote Logger
 * 
 * Extends the base Logger with automatic remote log capture.
 * Logs are buffered and sent in batches for efficiency.
 */
export class RemoteLogger extends Logger {
  private monitoringClient?: MonitoringClient;
  private remoteLevel: Severity;
  private bufferLogs: boolean;
  private buffer: BufferedLog[] = [];
  private flushInterval: number;
  private maxBufferSize: number;
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(config: RemoteLoggerConfig) {
    super(config);
    this.monitoringClient = config.monitoringClient;
    this.remoteLevel = config.remoteLevel || 'info';
    this.bufferLogs = config.bufferLogs ?? true;
    this.flushInterval = config.flushInterval || 5000;
    this.maxBufferSize = config.maxBufferSize || 100;

    // Start buffer flush timer
    if (this.bufferLogs && this.monitoringClient) {
      this.startFlushTimer();
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushInterval);
  }

  private shouldSendRemotely(level: Severity): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.remoteLevel];
  }

  private addToBuffer(log: BufferedLog): void {
    this.buffer.push(log);
    
    // Auto-flush if buffer is full
    if (this.buffer.length >= this.maxBufferSize) {
      this.flush().catch(console.error);
    }
  }

  private sendLog(level: Severity, message: string, context?: LogContext): void {
    if (!this.monitoringClient || !this.shouldSendRemotely(level)) {
      return;
    }

    const log: BufferedLog = {
      level,
      message,
      data: context as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    };

    if (this.bufferLogs) {
      this.addToBuffer(log);
    } else {
      this.monitoringClient.captureLog(level, message, context).catch(console.error);
    }
  }

  /**
   * Flush buffered logs to monitoring service
   */
  async flush(): Promise<void> {
    if (!this.monitoringClient || this.buffer.length === 0) {
      return;
    }

    const logsToSend = [...this.buffer];
    this.buffer = [];

    try {
      await this.monitoringClient.captureLogs(logsToSend);
    } catch (err) {
      // Put logs back in buffer on failure (up to max size)
      this.buffer = [...logsToSend.slice(0, this.maxBufferSize - this.buffer.length), ...this.buffer];
      console.error('[RemoteLogger] Failed to flush logs:', err);
    }
  }

  /**
   * Stop the flush timer and flush remaining logs
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    await this.flush();
  }

  // Override log methods to also send remotely

  override debug(message: string, context?: LogContext): void {
    super.debug(message, context);
    this.sendLog('debug', message, context);
  }

  override info(message: string, context?: LogContext): void {
    super.info(message, context);
    this.sendLog('info', message, context);
  }

  override warn(message: string, context?: LogContext): void {
    super.warn(message, context);
    this.sendLog('warning', message, context);
  }

  override error(message: string, context?: LogContext): void;
  override error(error: Error, context?: LogContext): void;
  override error(message: string, error: Error, context?: LogContext): void;
  override error(
    messageOrError: string | Error,
    errorOrContext?: Error | LogContext,
    context?: LogContext
  ): void {
    // Call parent error method
    if (messageOrError instanceof Error) {
      super.error(messageOrError, errorOrContext as LogContext);
      this.sendLog('error', messageOrError.message, {
        error: {
          name: messageOrError.name,
          message: messageOrError.message,
          stack: messageOrError.stack,
        },
        ...(errorOrContext as LogContext),
      });
    } else if (errorOrContext instanceof Error) {
      super.error(messageOrError, errorOrContext, context);
      this.sendLog('error', messageOrError, {
        error: {
          name: errorOrContext.name,
          message: errorOrContext.message,
          stack: errorOrContext.stack,
        },
        ...context,
      });
    } else {
      super.error(messageOrError, errorOrContext as LogContext);
      this.sendLog('error', messageOrError, errorOrContext as LogContext);
    }
  }

  override fatal(message: string, context?: LogContext): void;
  override fatal(error: Error, context?: LogContext): void;
  override fatal(messageOrError: string | Error, context?: LogContext): void {
    if (messageOrError instanceof Error) {
      super.fatal(messageOrError, context);
      this.sendLog('fatal', messageOrError.message, {
        error: {
          name: messageOrError.name,
          message: messageOrError.message,
          stack: messageOrError.stack,
        },
        ...context,
      });
    } else {
      super.fatal(messageOrError, context);
      this.sendLog('fatal', messageOrError, context);
    }
  }
}

/**
 * Create a remote logger instance
 */
export function createRemoteLogger(config: RemoteLoggerConfig): RemoteLogger {
  return new RemoteLogger(config);
}
