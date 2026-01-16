import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Request, Response } from 'express';
import { MonitoringClient, addBreadcrumb } from './monitoring-client.js';
import { RequestContextService } from '@dex-monit/observability-request-context';
import { Severity } from '@dex-monit/observability-contracts';

// Token for injecting monitoring client
export const HTTP_TRACE_MONITORING_TOKEN = 'HTTP_TRACE_MONITORING_CLIENT';

export interface HttpTrace {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  path: string;
  statusCode: number;
  duration: number; // ms
  ip: string;
  userAgent?: string;
  referer?: string;
  contentType?: string;
  contentLength?: number;
  requestId?: string;
  transactionId?: string;
  userId?: string;
  error?: string;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  responseSize?: number;
}

// In-memory storage for recent traces (circular buffer)
const MAX_TRACES = 1000;
let traces: HttpTrace[] = [];
let traceIndex = 0;

/**
 * Get all captured HTTP traces
 */
export function getHttpTraces(): HttpTrace[] {
  return [...traces].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/**
 * Get traces filtered by criteria
 */
export function filterTraces(options: {
  method?: string;
  statusCode?: number;
  minDuration?: number;
  path?: string;
  since?: Date;
}): HttpTrace[] {
  return getHttpTraces().filter((trace) => {
    if (options.method && trace.method !== options.method) return false;
    if (options.statusCode && trace.statusCode !== options.statusCode)
      return false;
    if (options.minDuration && trace.duration < options.minDuration)
      return false;
    if (options.path && !trace.path.includes(options.path)) return false;
    if (options.since && new Date(trace.timestamp) < options.since)
      return false;
    return true;
  });
}

/**
 * Clear all traces
 */
export function clearTraces(): void {
  traces = [];
  traceIndex = 0;
}

/**
 * Get trace statistics
 */
export function getTraceStats(): {
  total: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  avgDuration: number;
  slowestEndpoints: Array<{ path: string; avgDuration: number; count: number }>;
  errorRate: number;
} {
  const allTraces = getHttpTraces();
  const total = allTraces.length;

  if (total === 0) {
    return {
      total: 0,
      byMethod: {},
      byStatus: {},
      avgDuration: 0,
      slowestEndpoints: [],
      errorRate: 0,
    };
  }

  const byMethod: Record<string, number> = {};
  const byStatus: Record<string, number> = {};
  const endpointStats: Record<
    string,
    { totalDuration: number; count: number }
  > = {};
  let totalDuration = 0;
  let errorCount = 0;

  for (const trace of allTraces) {
    // By method
    byMethod[trace.method] = (byMethod[trace.method] || 0) + 1;

    // By status category
    const statusCategory = `${Math.floor(trace.statusCode / 100)}xx`;
    byStatus[statusCategory] = (byStatus[statusCategory] || 0) + 1;

    // Duration
    totalDuration += trace.duration;

    // Errors
    if (trace.statusCode >= 400) {
      errorCount++;
    }

    // Endpoint stats
    const key = `${trace.method} ${trace.path}`;
    if (!endpointStats[key]) {
      endpointStats[key] = { totalDuration: 0, count: 0 };
    }
    endpointStats[key].totalDuration += trace.duration;
    endpointStats[key].count++;
  }

  // Calculate slowest endpoints
  const slowestEndpoints = Object.entries(endpointStats)
    .map(([path, stats]) => ({
      path,
      avgDuration: Math.round(stats.totalDuration / stats.count),
      count: stats.count,
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
    .slice(0, 10);

  return {
    total,
    byMethod,
    byStatus,
    avgDuration: Math.round(totalDuration / total),
    slowestEndpoints,
    errorRate: Math.round((errorCount / total) * 100),
  };
}

/**
 * HTTP Interceptor for capturing all requests
 */
@Injectable()
export class HttpTraceInterceptor implements NestInterceptor {
  private monitoringClient?: MonitoringClient;

  constructor(monitoringClient?: MonitoringClient) {
    this.monitoringClient = monitoringClient;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const startTime = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestContext = RequestContextService.get();

    // Extract request info
    const method = request.method;
    const url = request.originalUrl || request.url;
    const path = request.path || url.split('?')[0];
    const ip = this.getClientIp(request);
    const userAgent = request.headers['user-agent'];
    const referer = request.headers['referer'] as string | undefined;
    const contentType = request.headers['content-type'];
    const contentLength = request.headers['content-length']
      ? parseInt(request.headers['content-length'] as string, 10)
      : undefined;

    return next.handle().pipe(
      tap((responseBody) => {
        const duration = Date.now() - startTime;
        const statusCode = response.statusCode;

        this.recordTrace({
          method,
          url,
          path,
          statusCode,
          duration,
          ip,
          userAgent,
          referer,
          contentType,
          contentLength,
          requestId: requestContext?.requestId,
          transactionId: requestContext?.transactionId,
          query: request.query as Record<string, unknown>,
          params: request.params as Record<string, unknown>,
          responseSize: this.getResponseSize(responseBody),
        });
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        const statusCode = error.status || error.statusCode || 500;

        this.recordTrace({
          method,
          url,
          path,
          statusCode,
          duration,
          ip,
          userAgent,
          referer,
          contentType,
          contentLength,
          requestId: requestContext?.requestId,
          transactionId: requestContext?.transactionId,
          query: request.query as Record<string, unknown>,
          params: request.params as Record<string, unknown>,
          error: error.message,
        });

        throw error;
      }),
    );
  }

  private recordTrace(data: Omit<HttpTrace, 'id' | 'timestamp'>): void {
    const trace: HttpTrace = {
      id: `trace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      timestamp: new Date().toISOString(),
      ...data,
    };

    // Store in circular buffer
    if (traces.length < MAX_TRACES) {
      traces.push(trace);
    } else {
      traces[traceIndex] = trace;
      traceIndex = (traceIndex + 1) % MAX_TRACES;
    }

    // Add breadcrumb
    addBreadcrumb({
      category: 'http',
      type: 'http',
      message: `${data.method} ${data.path}`,
      level: this.getLevel(data.statusCode),
      data: {
        url: data.url,
        method: data.method,
        status_code: data.statusCode,
        duration: data.duration,
        reason: data.error,
      },
    });

    // Send to monitoring if client is configured
    if (this.monitoringClient?.isEnabled()) {
      this.sendTraceToMonitoring(trace);
    }
  }

  private getLevel(statusCode: number): Severity {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warning';
    return 'info';
  }

  private getClientIp(request: Request): string {
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      const ips = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0];
      return ips.trim();
    }

    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    return request.ip || request.socket?.remoteAddress || 'unknown';
  }

  private getResponseSize(body: unknown): number | undefined {
    if (!body) return undefined;

    try {
      const str = typeof body === 'string' ? body : JSON.stringify(body);
      return Buffer.byteLength(str, 'utf8');
    } catch {
      return undefined;
    }
  }

  private async sendTraceToMonitoring(trace: HttpTrace): Promise<void> {
    // Send to dedicated traces endpoint
    try {
      const config = this.monitoringClient?.getConfig();
      if (!config) return;

      const response = await fetch(`${config.apiUrl}/traces`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dex-Key': config.apiKey,
        },
        body: JSON.stringify({
          traceId: trace.id,
          method: trace.method,
          url: trace.url,
          path: trace.path,
          statusCode: trace.statusCode,
          duration: trace.duration,
          ip: trace.ip,
          userAgent: trace.userAgent,
          referer: trace.referer,
          contentType: trace.contentType,
          contentLength: trace.contentLength,
          responseSize: trace.responseSize,
          requestId: trace.requestId,
          transactionId: trace.transactionId,
          userId: trace.userId,
          error: trace.error,
          query: trace.query,
          params: trace.params,
          timestamp: trace.timestamp,
        }),
      });

      if (!response.ok) {
        console.error('[DEX SDK] Failed to send trace:', response.status);
      }
    } catch {
      // Silently fail
    }
  }
}

/**
 * Middleware to capture HTTP requests (alternative to interceptor)
 * Use this if you need to capture requests before NestJS routing
 */
export function createHttpTraceMiddleware() {
  return (req: Request, res: Response, next: () => void) => {
    const startTime = Date.now();
    const method = req.method;
    const url = req.originalUrl || req.url;
    const path = req.path || url.split('?')[0];

    // Get client IP
    const forwardedFor = req.headers['x-forwarded-for'];
    let ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (forwardedFor) {
      ip = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor.split(',')[0].trim();
    }

    // Capture response
    const originalEnd = res.end.bind(res);
    res.end = function (
      chunk?: unknown,
      encoding?: BufferEncoding | (() => void),
      cb?: () => void,
    ): Response {
      const duration = Date.now() - startTime;
      const requestContext = RequestContextService.get();

      const trace: HttpTrace = {
        id: `trace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        timestamp: new Date().toISOString(),
        method,
        url,
        path,
        statusCode: res.statusCode,
        duration,
        ip,
        userAgent: req.headers['user-agent'],
        referer: req.headers['referer'] as string | undefined,
        contentType: req.headers['content-type'],
        requestId: requestContext?.requestId,
        transactionId: requestContext?.transactionId,
        query: req.query as Record<string, unknown>,
      };

      // Store trace
      if (traces.length < MAX_TRACES) {
        traces.push(trace);
      } else {
        traces[traceIndex] = trace;
        traceIndex = (traceIndex + 1) % MAX_TRACES;
      }

      // Add breadcrumb
      addBreadcrumb({
        category: 'http',
        type: 'http',
        message: `${method} ${path}`,
        level:
          res.statusCode >= 500
            ? 'error'
            : res.statusCode >= 400
              ? 'warning'
              : 'info',
        data: {
          url,
          method,
          status_code: res.statusCode,
          duration,
        },
      });

      if (typeof encoding === 'function') {
        return originalEnd(chunk, encoding);
      }
      return originalEnd(chunk, encoding as BufferEncoding, cb);
    };

    next();
  };
}
