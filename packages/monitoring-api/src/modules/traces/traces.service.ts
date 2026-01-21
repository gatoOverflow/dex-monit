import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';
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

// Cache TTL in seconds
const STATS_CACHE_TTL = 60; // 1 minute

@Injectable()
export class TracesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    private readonly redis: RedisService,
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
   * Uses ClickHouse quantile functions when available for better performance
   * Results are cached in Redis for 1 minute
   */
  async getStats(projectId: string, startDate?: Date, endDate?: Date): Promise<TraceStats> {
    // Build cache key
    const cacheKey = `traces:stats:${projectId}:${startDate?.toISOString() || 'all'}:${endDate?.toISOString() || 'now'}`;

    // Try to get from cache
    return this.redis.getOrSet(
      cacheKey,
      () => this.computeStats(projectId, startDate, endDate),
      STATS_CACHE_TTL,
    );
  }

  /**
   * Compute stats - uses ClickHouse when available, falls back to Prisma
   */
  private async computeStats(projectId: string, startDate?: Date, endDate?: Date): Promise<TraceStats> {
    // Try ClickHouse first for better performance on large datasets
    if (this.clickhouse.isConnected()) {
      try {
        return await this.getStatsFromClickHouse(projectId, startDate, endDate);
      } catch (error) {
        this.logger.warn('ClickHouse stats failed, falling back to Prisma', { error });
      }
    }

    // Fallback to Prisma (PostgreSQL)
    return this.getStatsFromPrisma(projectId, startDate, endDate);
  }

  /**
   * Get stats from ClickHouse using quantile() functions
   */
  private async getStatsFromClickHouse(projectId: string, startDate?: Date, endDate?: Date): Promise<TraceStats> {
    const startTs = startDate?.toISOString().replace('T', ' ').replace('Z', '') || '2020-01-01 00:00:00';
    const endTs = endDate?.toISOString().replace('T', ' ').replace('Z', '') || new Date().toISOString().replace('T', ' ').replace('Z', '');

    // Get main stats with quantiles in a single query
    const mainStats = await this.clickhouse.query<{
      total: string;
      avg_duration: string;
      p50_duration: string;
      p95_duration: string;
      p99_duration: string;
      error_count: string;
      min_ts: string;
      max_ts: string;
    }>(`
      SELECT
        count() as total,
        avg(duration_ms) as avg_duration,
        quantile(0.50)(duration_ms) as p50_duration,
        quantile(0.95)(duration_ms) as p95_duration,
        quantile(0.99)(duration_ms) as p99_duration,
        countIf(status_code >= 400) as error_count,
        min(timestamp) as min_ts,
        max(timestamp) as max_ts
      FROM dex_monitoring.traces
      WHERE project_id = {projectId:String}
        AND timestamp >= {startTs:String}
        AND timestamp <= {endTs:String}
    `, { projectId, startTs, endTs });

    const stats = mainStats[0] || {
      total: '0',
      avg_duration: '0',
      p50_duration: '0',
      p95_duration: '0',
      p99_duration: '0',
      error_count: '0',
      min_ts: startTs,
      max_ts: endTs,
    };

    const total = parseInt(stats.total, 10);
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

    // Get counts by method
    const byMethodResult = await this.clickhouse.query<{ method: string; count: string }>(`
      SELECT method, count() as count
      FROM dex_monitoring.traces
      WHERE project_id = {projectId:String}
        AND timestamp >= {startTs:String}
        AND timestamp <= {endTs:String}
      GROUP BY method
    `, { projectId, startTs, endTs });

    const byMethod: Record<string, number> = {};
    for (const row of byMethodResult) {
      byMethod[row.method] = parseInt(row.count, 10);
    }

    // Get counts by status category
    const byStatusResult = await this.clickhouse.query<{ status_category: string; count: string }>(`
      SELECT concat(toString(intDiv(status_code, 100)), 'xx') as status_category, count() as count
      FROM dex_monitoring.traces
      WHERE project_id = {projectId:String}
        AND timestamp >= {startTs:String}
        AND timestamp <= {endTs:String}
      GROUP BY status_category
    `, { projectId, startTs, endTs });

    const byStatus: Record<string, number> = {};
    for (const row of byStatusResult) {
      byStatus[row.status_category] = parseInt(row.count, 10);
    }

    // Get slowest endpoints
    const slowestResult = await this.clickhouse.query<{
      method: string;
      path: string;
      avg_duration: string;
      count: string;
      error_count: string;
    }>(`
      SELECT
        method,
        path,
        avg(duration_ms) as avg_duration,
        count() as count,
        countIf(status_code >= 400) as error_count
      FROM dex_monitoring.traces
      WHERE project_id = {projectId:String}
        AND timestamp >= {startTs:String}
        AND timestamp <= {endTs:String}
      GROUP BY method, path
      ORDER BY avg_duration DESC
      LIMIT 10
    `, { projectId, startTs, endTs });

    const slowestEndpoints = slowestResult.map((row) => ({
      method: row.method,
      path: row.path,
      avgDuration: Math.round(parseFloat(row.avg_duration)),
      count: parseInt(row.count, 10),
      errorCount: parseInt(row.error_count, 10),
    }));

    // Calculate requests per minute
    const minTs = new Date(stats.min_ts).getTime();
    const maxTs = new Date(stats.max_ts).getTime();
    const timeRangeMs = maxTs - minTs;
    const requestsPerMinute = timeRangeMs > 0 ? Math.round((total / timeRangeMs) * 60000) : 0;

    return {
      total,
      byMethod,
      byStatus,
      avgDuration: Math.round(parseFloat(stats.avg_duration)),
      p50Duration: Math.round(parseFloat(stats.p50_duration)),
      p95Duration: Math.round(parseFloat(stats.p95_duration)),
      p99Duration: Math.round(parseFloat(stats.p99_duration)),
      errorRate: Math.round((parseInt(stats.error_count, 10) / total) * 100),
      slowestEndpoints,
      requestsPerMinute,
    };
  }

  /**
   * Get stats from Prisma (PostgreSQL) - fallback method
   */
  private async getStatsFromPrisma(projectId: string, startDate?: Date, endDate?: Date): Promise<TraceStats> {
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
