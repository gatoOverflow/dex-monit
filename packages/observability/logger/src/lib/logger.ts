import pino, { Logger as PinoLogger, LoggerOptions } from 'pino';
import { RequestContextService } from '@dex-monit/observability-request-context';
import { scrubSensitiveData, ScrubberOptions } from '@dex-monit/observability-scrubber';

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Service/application name */
  name: string;
  /** Log level */
  level?: 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  /** Environment name */
  environment?: string;
  /** Whether to pretty print (development only) */
  prettyPrint?: boolean;
  /** Additional base context to include in all logs */
  baseContext?: Record<string, unknown>;
  /** Scrubber options for sensitive data */
  scrubberOptions?: ScrubberOptions;
  /** Custom pino options */
  pinoOptions?: LoggerOptions;
}

/**
 * Context to be added to log entries
 */
export interface LogContext {
  [key: string]: unknown;
}

/**
 * Create the base pino logger with configuration
 */
function createPinoLogger(config: LoggerConfig): PinoLogger {
  const {
    name,
    level = 'info',
    environment = process.env['NODE_ENV'] || 'development',
    prettyPrint = false,
    baseContext = {},
    pinoOptions = {},
  } = config;

  const options: LoggerOptions = {
    name,
    level,
    base: {
      service: name,
      environment,
      ...baseContext,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    ...pinoOptions,
  };

  // Use pino-pretty in development if requested
  if (prettyPrint && environment === 'development') {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    });
  }

  return pino(options);
}

/**
 * Observability Logger
 * Pino-based structured JSON logger with automatic request context injection
 */
export class Logger {
  private pino: PinoLogger;
  private scrubberOptions?: ScrubberOptions;

  constructor(config: LoggerConfig) {
    this.pino = createPinoLogger(config);
    this.scrubberOptions = config.scrubberOptions;
  }

  /**
   * Get request context data to inject into logs
   */
  private getRequestContext(): Record<string, unknown> {
    const ctx = RequestContextService.get();
    if (!ctx) {
      return {};
    }

    return {
      requestId: ctx.requestId,
      transactionId: ctx.transactionId,
      userId: ctx.userId,
    };
  }

  /**
   * Prepare context for logging (scrub sensitive data and add request context)
   */
  private prepareContext(context?: LogContext): Record<string, unknown> {
    const requestContext = this.getRequestContext();
    const merged = { ...requestContext, ...context };

    if (this.scrubberOptions || context) {
      return scrubSensitiveData(merged, this.scrubberOptions);
    }

    return merged;
  }

  /**
   * Log a debug message
   */
  debug(message: string, context?: LogContext): void {
    this.pino.debug(this.prepareContext(context), message);
  }

  /**
   * Log an info message
   */
  info(message: string, context?: LogContext): void {
    this.pino.info(this.prepareContext(context), message);
  }

  /**
   * Log a warning message
   */
  warn(message: string, context?: LogContext): void {
    this.pino.warn(this.prepareContext(context), message);
  }

  /**
   * Log an error message
   */
  error(message: string, context?: LogContext): void;
  error(error: Error, context?: LogContext): void;
  error(message: string, error: Error, context?: LogContext): void;
  error(
    messageOrError: string | Error,
    errorOrContext?: Error | LogContext,
    context?: LogContext
  ): void {
    let logMessage: string;
    let logContext: Record<string, unknown>;

    if (messageOrError instanceof Error) {
      // error(error, context?)
      logMessage = messageOrError.message;
      logContext = this.prepareContext({
        error: {
          name: messageOrError.name,
          message: messageOrError.message,
          stack: messageOrError.stack,
        },
        ...(errorOrContext as LogContext),
      });
    } else if (errorOrContext instanceof Error) {
      // error(message, error, context?)
      logMessage = messageOrError;
      logContext = this.prepareContext({
        error: {
          name: errorOrContext.name,
          message: errorOrContext.message,
          stack: errorOrContext.stack,
        },
        ...context,
      });
    } else {
      // error(message, context?)
      logMessage = messageOrError;
      logContext = this.prepareContext(errorOrContext as LogContext);
    }

    this.pino.error(logContext, logMessage);
  }

  /**
   * Log a fatal message
   */
  fatal(message: string, context?: LogContext): void;
  fatal(error: Error, context?: LogContext): void;
  fatal(
    messageOrError: string | Error,
    context?: LogContext
  ): void {
    if (messageOrError instanceof Error) {
      this.pino.fatal(
        this.prepareContext({
          error: {
            name: messageOrError.name,
            message: messageOrError.message,
            stack: messageOrError.stack,
          },
          ...context,
        }),
        messageOrError.message
      );
    } else {
      this.pino.fatal(this.prepareContext(context), messageOrError);
    }
  }

  /**
   * Create a child logger with additional base context
   */
  child(context: LogContext): Logger {
    const childLogger = Object.create(this) as Logger;
    childLogger.pino = this.pino.child(scrubSensitiveData(context, this.scrubberOptions));
    return childLogger;
  }

  /**
   * Get the underlying pino instance
   */
  getPino(): PinoLogger {
    return this.pino;
  }
}

/**
 * Create a new logger instance
 */
export function createLogger(config: LoggerConfig): Logger {
  return new Logger(config);
}

/**
 * Default logger instance (must be initialized with configure())
 */
let defaultLogger: Logger | null = null;

/**
 * Configure the default logger
 */
export function configureLogger(config: LoggerConfig): Logger {
  defaultLogger = new Logger(config);
  return defaultLogger;
}

/**
 * Get the default logger instance
 * @throws Error if logger not configured
 */
export function getLogger(): Logger {
  if (!defaultLogger) {
    throw new Error('Logger not configured. Call configureLogger() first.');
  }
  return defaultLogger;
}

/**
 * Token for injecting the logger in NestJS
 */
export const LOGGER_TOKEN = 'OBSERVABILITY_LOGGER';
