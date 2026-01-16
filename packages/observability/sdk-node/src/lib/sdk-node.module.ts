import {
  Module,
  DynamicModule,
  Global,
  MiddlewareConsumer,
  NestModule,
  OnModuleDestroy,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { RequestIdMiddleware } from './request-id.middleware.js';
import { GlobalExceptionFilter } from './global-exception.filter.js';
import { ErrorCaptureInterceptor } from './error-capture.interceptor.js';
import {
  MonitoringClient,
  MonitoringClientConfig,
  createMonitoringClient,
} from './monitoring-client.js';
import { RemoteLogger, createRemoteLogger } from './remote-logger.js';
import { DexLoggerService, DEX_LOGGER_TOKEN } from './dex-logger.service.js';
import { startConsoleCapture, stopConsoleCapture } from './console-capture.js';
import {
  startNestLoggerCapture,
  stopNestLoggerCapture,
} from './nest-logger-capture.js';
import { HttpTraceInterceptor } from './http-interceptor.js';
import {
  Logger,
  LoggerConfig,
  LOGGER_TOKEN,
} from '@dex-monit/observability-logger';
import { Severity } from '@dex-monit/observability-contracts';

/**
 * SDK Node module configuration
 */
export interface SdkNodeModuleConfig {
  /** Logger configuration */
  logger: LoggerConfig;
  /** Monitoring client configuration (optional - if not provided, errors won't be sent) */
  monitoring?: MonitoringClientConfig;
  /** Whether to apply middleware globally */
  global?: boolean;
  /** Minimum log level to send remotely (default: 'debug' = capture all) */
  remoteLogLevel?: Severity;
  /** Whether to capture console.log/warn/error (default: true) */
  captureConsole?: boolean;
  /** Whether to capture NestJS native Logger (default: true) */
  captureNestLogger?: boolean;
  /** Whether to capture HTTP requests (default: true) */
  captureHttpRequests?: boolean;
}

// Re-export LOGGER_TOKEN for convenience
export { LOGGER_TOKEN };

/**
 * Token for injecting the monitoring client
 */
export const MONITORING_CLIENT_TOKEN = 'OBSERVABILITY_MONITORING_CLIENT';

/**
 * SDK Node Module
 *
 * Provides:
 * - Request ID middleware for tracing
 * - Error capture interceptor (captures ALL errors, even if other filters exist)
 * - Global exception filter for error capture
 * - DexLoggerService (NestJS compatible logger with remote capture)
 * - Console capture (intercepts console.log/warn/error)
 * - NestJS Logger capture (intercepts Logger.log/warn/error)
 * - Monitoring client instance
 */
@Global()
@Module({})
export class SdkNodeModule implements NestModule, OnModuleDestroy {
  private static remoteLogger: RemoteLogger | null = null;

  /**
   * Register the module with configuration
   */
  static forRoot(config: SdkNodeModuleConfig): DynamicModule {
    const monitoringClient = config.monitoring
      ? createMonitoringClient(config.monitoring)
      : undefined;

    // Use RemoteLogger if monitoring is configured
    const logger = createRemoteLogger({
      ...config.logger,
      monitoringClient,
      remoteLevel: config.remoteLogLevel || 'debug', // Default: capture ALL logs
    });

    // Store reference for cleanup
    SdkNodeModule.remoteLogger = logger;

    // Start captures if monitoring is configured
    if (monitoringClient) {
      const captureConsole = config.captureConsole ?? true;
      const captureNestLogger = config.captureNestLogger ?? true;

      // NestJS Logger capture (default: true) - START FIRST
      if (captureNestLogger) {
        startNestLoggerCapture(monitoringClient);
      }

      // Console capture (default: true)
      // Skip NestJS logs if we're also capturing NestJS Logger to avoid duplicates
      if (captureConsole) {
        startConsoleCapture(monitoringClient, {
          skipNestJsLogs: captureNestLogger,
        });
      }
    }

    return {
      module: SdkNodeModule,
      providers: [
        // Monitoring Client
        {
          provide: MONITORING_CLIENT_TOKEN,
          useValue: monitoringClient,
        },
        {
          provide: MonitoringClient,
          useValue: monitoringClient,
        },
        // DexLoggerService - the main logger to use
        {
          provide: DEX_LOGGER_TOKEN,
          useFactory: () => {
            const dexLogger = new DexLoggerService();
            dexLogger.setMonitoringClient(monitoringClient);
            return dexLogger;
          },
        },
        {
          provide: DexLoggerService,
          useFactory: () => {
            const dexLogger = new DexLoggerService();
            dexLogger.setMonitoringClient(monitoringClient);
            return dexLogger;
          },
        },
        // Legacy Logger support
        {
          provide: LOGGER_TOKEN,
          useValue: logger,
        },
        {
          provide: Logger,
          useValue: logger,
        },
        {
          provide: RemoteLogger,
          useValue: logger,
        },
        // Interceptor captures errors BEFORE any exception filter
        {
          provide: APP_INTERCEPTOR,
          useFactory: () => new ErrorCaptureInterceptor(monitoringClient),
        },
        // HTTP trace interceptor (captures all HTTP requests)
        ...((config.captureHttpRequests ?? true)
          ? [
              {
                provide: APP_INTERCEPTOR,
                useFactory: () => new HttpTraceInterceptor(monitoringClient),
              },
            ]
          : []),
        // Keep the filter as fallback for non-HTTP contexts
        {
          provide: APP_FILTER,
          useFactory: () => new GlobalExceptionFilter(logger, monitoringClient),
        },
        RequestIdMiddleware,
        HttpTraceInterceptor,
      ],
      exports: [
        // Main exports
        DexLoggerService,
        DEX_LOGGER_TOKEN,
        MONITORING_CLIENT_TOKEN,
        MonitoringClient,
        HttpTraceInterceptor,
        // Legacy exports
        LOGGER_TOKEN,
        Logger,
        RemoteLogger,
      ],
    };
  }

  /**
   * Configure middleware
   */
  configure(consumer: MiddlewareConsumer): void {
    // Apply RequestIdMiddleware to all routes
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }

  /**
   * Cleanup on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    // Stop captures
    stopConsoleCapture();
    stopNestLoggerCapture();

    // Flush remaining logs
    if (SdkNodeModule.remoteLogger) {
      await SdkNodeModule.remoteLogger.close();
    }
  }
}
