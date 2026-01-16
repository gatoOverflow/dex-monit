/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger as NestLogger, ConsoleLogger } from '@nestjs/common';
import { MonitoringClient } from './monitoring-client';
import { Severity } from '@dex-monit/observability-contracts';
import { RequestContextService } from '@dex-monit/observability-request-context';

type LogMethod = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

const NEST_TO_SEVERITY: Record<LogMethod, Severity> = {
  debug: 'debug',
  verbose: 'debug',
  log: 'info',
  warn: 'warning',
  error: 'error',
  fatal: 'fatal',
};

let originalStaticMethods: Record<LogMethod, any> | null = null;
let originalPrototypeMethods: Record<LogMethod, any> | null = null;
let originalConsoleLoggerMethods: Record<LogMethod, any> | null = null;
let isCapturing = false;
let monitoringClientRef: MonitoringClient | null = null;

/**
 * Send log to monitoring service
 */
function sendToMonitoring(
  severity: Severity,
  message: string,
  context?: string
): void {
  if (!monitoringClientRef) return;

  // Skip SDK internal logs to avoid loops
  if (context?.startsWith('DEX') || message.startsWith('[DEX') || message.startsWith('[MonitoringClient]')) {
    return;
  }

  const requestContext = RequestContextService.get();

  monitoringClientRef.captureLog(severity, message, {
    source: 'nest-logger',
    context,
    requestId: requestContext?.requestId,
    transactionId: requestContext?.transactionId,
  }).catch(() => {
    // Silently ignore
  });
}

/**
 * Extract message and context from NestJS logger arguments
 */
function extractMessageAndContext(
  message: any,
  optionalParams: any[]
): { message: string; context?: string } {
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  
  // Last param is usually the context
  const lastParam = optionalParams[optionalParams.length - 1];
  const context = typeof lastParam === 'string' ? lastParam : undefined;
  
  return { message: messageStr, context };
}

/**
 * Create a wrapped method that sends to monitoring
 */
function createWrappedMethod(
  original: any,
  severity: Severity,
  getContext?: () => string | undefined
): any {
  return function(this: any, message: any, ...optionalParams: any[]): void {
    // Call original method
    original.call(this, message, ...optionalParams);

    // Extract message and context
    const { message: msg, context } = extractMessageAndContext(message, optionalParams);
    const finalContext = context || (getContext ? getContext.call(this) : undefined);

    // Send to monitoring
    sendToMonitoring(severity, msg, finalContext);
  };
}

/**
 * Start capturing NestJS native Logger output
 */
export function startNestLoggerCapture(monitoringClient: MonitoringClient): void {
  if (isCapturing) {
    return;
  }

  monitoringClientRef = monitoringClient;

  const methods: LogMethod[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

  // 1. Patch static methods on NestLogger
  originalStaticMethods = {} as Record<LogMethod, any>;
  for (const method of methods) {
    if (typeof (NestLogger as any)[method] === 'function') {
      originalStaticMethods[method] = (NestLogger as any)[method].bind(NestLogger);
      (NestLogger as any)[method] = createWrappedMethod(
        originalStaticMethods[method],
        NEST_TO_SEVERITY[method]
      );
    }
  }

  // 2. Patch prototype methods on NestLogger
  originalPrototypeMethods = {} as Record<LogMethod, any>;
  for (const method of methods) {
    if (typeof NestLogger.prototype[method] === 'function') {
      originalPrototypeMethods[method] = NestLogger.prototype[method];
      (NestLogger.prototype as any)[method] = createWrappedMethod(
        originalPrototypeMethods[method],
        NEST_TO_SEVERITY[method],
        function(this: any) { return this.context; }
      );
    }
  }

  // 3. Patch ConsoleLogger prototype (NestJS internal logger)
  originalConsoleLoggerMethods = {} as Record<LogMethod, any>;
  for (const method of methods) {
    if (typeof ConsoleLogger.prototype[method] === 'function') {
      originalConsoleLoggerMethods[method] = ConsoleLogger.prototype[method];
      (ConsoleLogger.prototype as any)[method] = createWrappedMethod(
        originalConsoleLoggerMethods[method],
        NEST_TO_SEVERITY[method],
        function(this: any) { return this.context; }
      );
    }
  }

  isCapturing = true;
  console.log('[DEX SDK] NestJS Logger capture started');
}

/**
 * Stop capturing NestJS native Logger output
 */
export function stopNestLoggerCapture(): void {
  if (!isCapturing) {
    return;
  }

  const methods: LogMethod[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

  // Restore static methods
  if (originalStaticMethods) {
    for (const method of methods) {
      if (originalStaticMethods[method]) {
        (NestLogger as any)[method] = originalStaticMethods[method];
      }
    }
    originalStaticMethods = null;
  }

  // Restore prototype methods
  if (originalPrototypeMethods) {
    for (const method of methods) {
      if (originalPrototypeMethods[method]) {
        (NestLogger.prototype as any)[method] = originalPrototypeMethods[method];
      }
    }
    originalPrototypeMethods = null;
  }

  // Restore ConsoleLogger methods
  if (originalConsoleLoggerMethods) {
    for (const method of methods) {
      if (originalConsoleLoggerMethods[method]) {
        (ConsoleLogger.prototype as any)[method] = originalConsoleLoggerMethods[method];
      }
    }
    originalConsoleLoggerMethods = null;
  }

  monitoringClientRef = null;
  isCapturing = false;
}

/**
 * Check if NestJS Logger capture is active
 */
export function isNestLoggerCaptureActive(): boolean {
  return isCapturing;
}
