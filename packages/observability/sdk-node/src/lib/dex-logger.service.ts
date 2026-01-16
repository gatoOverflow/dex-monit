import { Injectable, LoggerService, Scope } from '@nestjs/common';
import { MonitoringClient } from './monitoring-client';
import { Severity } from '@dex-monit/observability-contracts';
import { RequestContextService } from '@dex-monit/observability-request-context';

/**
 * Token for injecting DexLoggerService
 */
export const DEX_LOGGER_TOKEN = 'DEX_LOGGER_SERVICE';

/**
 * DexLoggerService - NestJS compatible logger that sends logs to monitoring
 * 
 * Usage:
 * 1. Inject in any service/controller: constructor(private logger: DexLoggerService)
 * 2. Use as app logger: app.useLogger(app.get(DexLoggerService))
 * 
 * Example:
 * ```typescript
 * @Injectable()
 * export class MyService {
 *   constructor(private readonly logger: DexLoggerService) {
 *     this.logger.setContext('MyService');
 *   }
 * 
 *   doSomething() {
 *     this.logger.log('Doing something');
 *     this.logger.warn('This is a warning');
 *     this.logger.error('This is an error');
 *   }
 * }
 * ```
 */
@Injectable({ scope: Scope.TRANSIENT })
export class DexLoggerService implements LoggerService {
  private context?: string;
  private monitoringClient?: MonitoringClient;

  /**
   * Set the monitoring client (called by module)
   */
  setMonitoringClient(client?: MonitoringClient): void {
    this.monitoringClient = client;
  }

  /**
   * Set the context (usually the class name)
   */
  setContext(context: string): this {
    this.context = context;
    return this;
  }

  /**
   * Log a message (info level)
   */
  log(message: string, context?: string): void;
  log(message: string, ...optionalParams: unknown[]): void;
  log(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.writeLog('info', message, ctx);
  }

  /**
   * Log an error message
   */
  error(message: string, stackOrContext?: string): void;
  error(message: string, stack?: string, context?: string): void;
  error(message: string, ...optionalParams: unknown[]): void {
    const { context, stack } = this.extractErrorParams(optionalParams);
    this.writeLog('error', message, context, { stack });
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: string): void;
  warn(message: string, ...optionalParams: unknown[]): void;
  warn(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.writeLog('warning', message, ctx);
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: string): void;
  debug(message: string, ...optionalParams: unknown[]): void;
  debug(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.writeLog('debug', message, ctx);
  }

  /**
   * Log a verbose message (maps to debug)
   */
  verbose(message: string, context?: string): void;
  verbose(message: string, ...optionalParams: unknown[]): void;
  verbose(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.writeLog('debug', message, ctx);
  }

  /**
   * Log a fatal message
   */
  fatal(message: string, context?: string): void;
  fatal(message: string, ...optionalParams: unknown[]): void;
  fatal(message: string, ...optionalParams: unknown[]): void {
    const ctx = this.extractContext(optionalParams);
    this.writeLog('fatal', message, ctx);
  }

  /**
   * Internal: write log to console and send to monitoring
   */
  private writeLog(
    level: Severity,
    message: string,
    context?: string,
    extra?: Record<string, unknown>
  ): void {
    const ctx = context || this.context || 'Application';
    const requestContext = RequestContextService.get();
    const timestamp = new Date().toISOString();

    // Format for console output
    const logData = {
      timestamp,
      level: level.toUpperCase(),
      context: ctx,
      message,
      requestId: requestContext?.requestId,
      transactionId: requestContext?.transactionId,
      ...extra,
    };

    // Write to console (JSON format)
    const consoleMethod = this.getConsoleMethod(level);
    consoleMethod(JSON.stringify(logData));

    // Send to monitoring (fire and forget)
    if (this.monitoringClient) {
      this.monitoringClient.captureLog(level, message, {
        context: ctx,
        requestId: requestContext?.requestId,
        transactionId: requestContext?.transactionId,
        ...extra,
      }).catch(() => {
        // Silently fail
      });
    }
  }

  /**
   * Get the appropriate console method for the log level
   */
  private getConsoleMethod(level: Severity): (...args: unknown[]) => void {
    switch (level) {
      case 'debug':
        return console.debug.bind(console);
      case 'info':
        return console.log.bind(console);
      case 'warning':
        return console.warn.bind(console);
      case 'error':
      case 'fatal':
        return console.error.bind(console);
      default:
        return console.log.bind(console);
    }
  }

  /**
   * Extract context from optional params
   */
  private extractContext(optionalParams: unknown[]): string | undefined {
    const lastParam = optionalParams[optionalParams.length - 1];
    if (typeof lastParam === 'string') {
      return lastParam;
    }
    return undefined;
  }

  /**
   * Extract context and stack from error params
   */
  private extractErrorParams(optionalParams: unknown[]): {
    context?: string;
    stack?: string;
  } {
    if (optionalParams.length === 0) {
      return {};
    }

    if (optionalParams.length === 1) {
      const param = optionalParams[0];
      if (typeof param === 'string') {
        // Could be stack or context - check if it looks like a stack
        if (param.includes('\n') && param.includes('at ')) {
          return { stack: param };
        }
        return { context: param };
      }
    }

    if (optionalParams.length >= 2) {
      return {
        stack: typeof optionalParams[0] === 'string' ? optionalParams[0] : undefined,
        context: typeof optionalParams[1] === 'string' ? optionalParams[1] : undefined,
      };
    }

    return {};
  }
}
