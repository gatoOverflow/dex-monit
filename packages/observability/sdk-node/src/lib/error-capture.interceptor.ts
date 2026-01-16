import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Request } from 'express';
import * as os from 'os';
import { MonitoringClient } from './monitoring-client';

/**
 * Error Capture Interceptor
 * 
 * Intercepts all errors and sends them to the monitoring service.
 * Unlike ExceptionFilters, Interceptors run BEFORE other filters,
 * so this will capture errors even if another filter handles them.
 */
@Injectable()
export class ErrorCaptureInterceptor implements NestInterceptor {
  constructor(
    private readonly monitoringClient?: MonitoringClient
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error) => {
        // Capture the error
        this.captureError(error, context);
        
        // Re-throw so other handlers can process it
        return throwError(() => error);
      })
    );
  }

  private captureError(error: unknown, context: ExecutionContext): void {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest<Request>();

    // Log the error
    const errorObj = error instanceof Error ? error : new Error(String(error));
    
    console.log('[DEX SDK] Error captured by interceptor:', errorObj.message);

    // Send to monitoring service (async, don't wait)
    if (this.monitoringClient) {
      console.log('[DEX SDK] Sending error to monitoring...');
      
      this.monitoringClient
        .captureException(errorObj, {
          // Full request context like Sentry
          request: {
            url: this.getFullUrl(request),
            method: request?.method,
            headers: this.sanitizeHeaders(request?.headers as Record<string, string> || {}),
            query: request?.query as Record<string, string>,
            body: this.sanitizeBody(request?.body),
            cookies: this.sanitizeCookies(request?.cookies),
          },
          // OS context
          context: {
            os: {
              name: os.platform(),
              version: os.release(),
              kernelVersion: os.release(),
            },
            runtime: {
              name: 'node',
              version: process.version,
            },
            device: {
              arch: os.arch(),
              memory: os.totalmem(),
              cpus: os.cpus().length,
              hostname: os.hostname(),
            },
            app: {
              startTime: process.uptime(),
              memoryUsage: process.memoryUsage(),
            },
          },
          // Tags for filtering
          tags: {
            'http.method': request?.method || 'unknown',
            'http.status_code': '500',
            'runtime': 'node',
            'runtime.version': process.version,
            'os': os.platform(),
          },
        })
        .then(() => {
          console.log('[DEX SDK] Error sent successfully!');
        })
        .catch((err) => {
          console.error('[DEX SDK] Failed to send error:', err);
        });
    } else {
      console.log('[DEX SDK] No monitoring client configured');
    }
  }

  private getFullUrl(request: Request): string {
    if (!request) return 'unknown';
    const protocol = request.protocol || 'http';
    const host = request.get?.('host') || request.hostname || 'localhost';
    const path = request.originalUrl || request.url || '/';
    return `${protocol}://${host}${path}`;
  }

  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-dex-key', 'x-auth-token'];
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[Filtered]';
      } else if (typeof value === 'string') {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private sanitizeBody(body: unknown): Record<string, unknown> | undefined {
    if (!body || typeof body !== 'object') return undefined;
    
    const sensitiveKeys = ['password', 'token', 'secret', 'apiKey', 'api_key', 'credit_card', 'cvv'];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(body)) {
      if (sensitiveKeys.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
        sanitized[key] = '[Filtered]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private sanitizeCookies(cookies: unknown): Record<string, string> | undefined {
    if (!cookies || typeof cookies !== 'object') return undefined;
    
    const sanitized: Record<string, string> = {};
    for (const key of Object.keys(cookies)) {
      sanitized[key] = '[Filtered]';
    }
    return sanitized;
  }
}
