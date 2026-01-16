import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import type { HttpTrace, Prisma } from '@prisma/client';

export interface CreateHttpTraceDto {
  traceId: string;
  method: string;
  url: string;
  path: string;
  statusCode: number;
  duration: number;
  ip?: string;
  userAgent?: string;
  referer?: string;
  contentType?: string;
  contentLength?: number;
  responseSize?: number;
  requestId?: string;
  transactionId?: string;
  userId?: string;
  error?: string;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  headers?: Record<string, unknown>;
  environment?: string;
  serverName?: string;
  timestamp?: string;
}

export interface ListTracesParams {
  projectId: string;
  method?: string;
  statusCode?: number;
  minDuration?: number;
  maxDuration?: number;
  path?: string;
  hasError?: boolean;
  startDate?: Date;
  endDate?: Date;
  skip?: number;
  take?: number;
  sortBy?: 'timestamp' | 'duration' | 'statusCode';
  sortOrder?: 'asc' | 'desc';
}

export interface TraceStats {
  total: number;
  byMethod: Record<string, number>;
  byStatus: Record<string, number>;
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;
  errorRate: number;
  slowestEndpoints: Array<{
    path: string;
    method: string;
    avgDuration: number;
    count: number;
    errorCount: number;
  }>;
  requestsPerMinute: number;
}

@Injectable()
export class TracesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Create a new HTTP trace
   */
  async create(projectId: string, data: CreateHttpTraceDto): Promise<HttpTrace> {
    return this.prisma.httpTrace.create({
      data: {
        projectId,
        traceId: data.traceId,
        timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
        method: data.method,
        url: data.url,
        path: data.path,
        statusCode: data.statusCode,
        duration: data.duration,
        ip: data.ip,
        userAgent: data.userAgent,
        referer: data.referer,
        contentType: data.contentType,
        contentLength: data.contentLength,
        responseSize: data.responseSize,
        requestId: data.requestId,
        transactionId: data.transactionId,
        userId: data.userId,
        error: data.error,
        query: data.query as Prisma.JsonValue,
        params: data.params as Prisma.JsonValue,
        headers: data.headers as Prisma.JsonValue,
        environment: data.environment || 'production',
        serverName: data.serverName,
      },
    });
  }

  /**
   * Create multiple HTTP traces in batch
   */
  async createMany(projectId: string, traces: CreateHttpTraceDto[]): Promise<number> {
    // Filter out invalid traces
    const validTraces = traces.filter((data) => {
      if (!data.traceId || !data.method || !data.url || !data.path) {
        this.logger.warn('Skipping invalid trace - missing required fields', {
          hasTraceId: !!data.traceId,
          hasMethod: !!data.method,
          hasUrl: !!data.url,
          hasPath: !!data.path,
        });
        return false;
      }
      return true;
    });

    if (validTraces.length === 0) {
      return 0;
    }

    try {
      const result = await this.prisma.httpTrace.createMany({
        data: validTraces.map((data) => ({
          projectId,
          traceId: data.traceId,
          timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
          method: data.method,
          url: data.url,
          path: data.path,
          statusCode: data.statusCode || 0,
          duration: data.duration || 0,
          ip: data.ip,
          userAgent: data.userAgent,
          referer: data.referer,
          contentType: data.contentType,
          contentLength: data.contentLength,
          responseSize: data.responseSize,
          requestId: data.requestId,
          transactionId: data.transactionId,
          userId: data.userId,
          error: data.error,
          query: data.query as Prisma.JsonValue,
          params: data.params as Prisma.JsonValue,
          headers: data.headers as Prisma.JsonValue,
          environment: data.environment || 'production',
          serverName: data.serverName,
        })),
        skipDuplicates: true,
      });
      return result.count;
    } catch (error) {
      this.logger.error('Failed to create traces', { error, traceCount: validTraces.length });
      throw error;
    }
  }

  /**
   * List HTTP traces with filtering
   */
  async list(params: ListTracesParams): Promise<{ data: HttpTrace[]; total: number }> {
    const {
      projectId,
      method,
      statusCode,
      minDuration,
      maxDuration,
      path,
      hasError,
      startDate,
      endDate,
      skip = 0,
      take = 50,
      sortBy = 'timestamp',
      sortOrder = 'desc',
    } = params;

    const where: Prisma.HttpTraceWhereInput = {
      projectId,
      ...(method && { method }),
      ...(statusCode && { statusCode }),
      ...(minDuration && { duration: { gte: minDuration } }),
      ...(maxDuration && { duration: { lte: maxDuration } }),
      ...(path && { path: { contains: path } }),
      ...(hasError !== undefined && {
        statusCode: hasError ? { gte: 400 } : { lt: 400 },
      }),
      ...(startDate && { timestamp: { gte: startDate } }),
      ...(endDate && { timestamp: { lte: endDate } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.httpTrace.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.httpTrace.count({ where }),
    ]);

    return { data, total };
  }

  /**
   * Get a single trace by ID
   */
  async findById(id: string): Promise<HttpTrace | null> {
    return this.prisma.httpTrace.findUnique({ where: { id } });
  }

  /**
   * Get trace statistics for a project
   */
  async getStats(projectId: string, startDate?: Date, endDate?: Date): Promise<TraceStats> {
    const where: Prisma.HttpTraceWhereInput = {
      projectId,
      ...(startDate && { timestamp: { gte: startDate } }),
      ...(endDate && { timestamp: { lte: endDate } }),
    };

    // Get all traces for calculations
    const traces = await this.prisma.httpTrace.findMany({
      where,
      select: {
        method: true,
        statusCode: true,
        duration: true,
        path: true,
        error: true,
        timestamp: true,
      },
      orderBy: { timestamp: 'desc' },
      take: 10000, // Limit for performance
    });

    const total = traces.length;
    if (total === 0) {
      return {
        total: 0,
        byMethod: {},
        byStatus: {},
        avgDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
        errorRate: 0,
        slowestEndpoints: [],
        requestsPerMinute: 0,
      };
    }

    // Calculate statistics
    const byMethod: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const endpointStats: Record<string, { totalDuration: number; count: number; errors: number }> = {};
    const durations: number[] = [];
    let errorCount = 0;

    for (const trace of traces) {
      // By method
      byMethod[trace.method] = (byMethod[trace.method] || 0) + 1;

      // By status
      const statusCategory = `${Math.floor(trace.statusCode / 100)}xx`;
      byStatus[statusCategory] = (byStatus[statusCategory] || 0) + 1;

      // Duration
      durations.push(trace.duration);

      // Errors
      if (trace.statusCode >= 400) {
        errorCount++;
      }

      // Endpoint stats
      const key = `${trace.method}:${trace.path}`;
      if (!endpointStats[key]) {
        endpointStats[key] = { totalDuration: 0, count: 0, errors: 0 };
      }
      endpointStats[key].totalDuration += trace.duration;
      endpointStats[key].count++;
      if (trace.statusCode >= 400) {
        endpointStats[key].errors++;
      }
    }

    // Calculate percentiles
    durations.sort((a, b) => a - b);
    const p50 = durations[Math.floor(total * 0.5)] || 0;
    const p95 = durations[Math.floor(total * 0.95)] || 0;
    const p99 = durations[Math.floor(total * 0.99)] || 0;
    const avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / total);

    // Slowest endpoints
    const slowestEndpoints = Object.entries(endpointStats)
      .map(([key, stats]) => {
        const [method, path] = key.split(':');
        return {
          method,
          path,
          avgDuration: Math.round(stats.totalDuration / stats.count),
          count: stats.count,
          errorCount: stats.errors,
        };
      })
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, 10);

    // Requests per minute (based on time range)
    const oldestTrace = traces[traces.length - 1];
    const newestTrace = traces[0];
    const timeRangeMs = new Date(newestTrace.timestamp).getTime() - new Date(oldestTrace.timestamp).getTime();
    const requestsPerMinute = timeRangeMs > 0 ? Math.round((total / timeRangeMs) * 60000) : 0;

    return {
      total,
      byMethod,
      byStatus,
      avgDuration,
      p50Duration: p50,
      p95Duration: p95,
      p99Duration: p99,
      errorRate: Math.round((errorCount / total) * 100),
      slowestEndpoints,
      requestsPerMinute,
    };
  }

  /**
   * Delete old traces (cleanup)
   */
  async deleteOldTraces(projectId: string, olderThan: Date): Promise<number> {
    const result = await this.prisma.httpTrace.deleteMany({
      where: {
        projectId,
        timestamp: { lt: olderThan },
      },
    });
    return result.count;
  }
}
