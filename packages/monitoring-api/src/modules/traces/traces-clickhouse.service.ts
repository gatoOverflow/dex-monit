import { Injectable, Inject } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Logger } from '@dex-monit/observability-logger';

export interface ClickHouseTrace {
  id: string;
  project_id: string;
  trace_id: string;
  timestamp: string;
  method: string;
  url: string;
  path: string;
  status_code: number;
  duration_ms: number;
  ip: string;
  user_agent: string;
  referer: string;
  request_size: number;
  response_size: number;
  request_id: string;
  transaction_id: string;
  user_id: string;
  environment: string;
  server_name: string;
  error: string;
  headers: string;
  query_params: string;
}

export interface CreateTraceDto {
  traceId: string;
  method: string;
  url: string;
  path: string;
  statusCode: number;
  duration: number;
  ip?: string;
  userAgent?: string;
  referer?: string;
  requestSize?: number;
  responseSize?: number;
  requestId?: string;
  transactionId?: string;
  userId?: string;
  environment?: string;
  serverName?: string;
  error?: string;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
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
  sortBy?: 'timestamp' | 'duration_ms' | 'status_code';
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
  requestsPerMinute: number;
  slowestEndpoints: Array<{
    path: string;
    method: string;
    avgDuration: number;
    count: number;
    errorRate: number;
  }>;
}

@Injectable()
export class TracesClickHouseService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly redis: RedisService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Ingest a single HTTP trace
   */
  async ingest(projectId: string, trace: CreateTraceDto): Promise<string> {
    const id = crypto.randomUUID();

    await this.clickhouse.insert('traces', [{
      id,
      project_id: projectId,
      trace_id: trace.traceId,
      timestamp: trace.timestamp || new Date().toISOString(),
      method: trace.method,
      url: trace.url,
      path: trace.path,
      status_code: trace.statusCode,
      duration_ms: trace.duration,
      ip: trace.ip || '',
      user_agent: trace.userAgent || '',
      referer: trace.referer || '',
      request_size: trace.requestSize || 0,
      response_size: trace.responseSize || 0,
      request_id: trace.requestId || '',
      transaction_id: trace.transactionId || '',
      user_id: trace.userId || '',
      environment: trace.environment || 'production',
      server_name: trace.serverName || '',
      error: trace.error || '',
      headers: JSON.stringify(trace.headers || {}),
      query_params: JSON.stringify(trace.query || {}),
    }]);

    // Invalidate stats cache
    await this.redis.delPattern(`traces:stats:${projectId}:*`);

    return id;
  }

  /**
   * Batch ingest multiple traces
   */
  async ingestBatch(projectId: string, traces: CreateTraceDto[]): Promise<number> {
    if (traces.length === 0) return 0;

    // Filter invalid traces
    const validTraces = traces.filter(t => t.traceId && t.method && t.url && t.path);

    if (validTraces.length === 0) return 0;

    const records = validTraces.map(trace => ({
      id: crypto.randomUUID(),
      project_id: projectId,
      trace_id: trace.traceId,
      timestamp: trace.timestamp || new Date().toISOString(),
      method: trace.method,
      url: trace.url,
      path: trace.path,
      status_code: trace.statusCode || 0,
      duration_ms: trace.duration || 0,
      ip: trace.ip || '',
      user_agent: trace.userAgent || '',
      referer: trace.referer || '',
      request_size: trace.requestSize || 0,
      response_size: trace.responseSize || 0,
      request_id: trace.requestId || '',
      transaction_id: trace.transactionId || '',
      user_id: trace.userId || '',
      environment: trace.environment || 'production',
      server_name: trace.serverName || '',
      error: trace.error || '',
      headers: JSON.stringify(trace.headers || {}),
      query_params: JSON.stringify(trace.query || {}),
    }));

    await this.clickhouse.insert('traces', records);

    // Invalidate stats cache
    await this.redis.delPattern(`traces:stats:${projectId}:*`);

    return records.length;
  }

  /**
   * List traces with filtering
   */
  async list(params: ListTracesParams): Promise<{ data: ClickHouseTrace[]; total: number }> {
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

    const conditions: string[] = ['project_id = {projectId:String}'];
    const queryParams: Record<string, unknown> = { projectId, skip, take };

    if (method) {
      conditions.push('method = {method:String}');
      queryParams.method = method;
    }

    if (statusCode) {
      conditions.push('status_code = {statusCode:UInt16}');
      queryParams.statusCode = statusCode;
    }

    if (minDuration) {
      conditions.push('duration_ms >= {minDuration:UInt32}');
      queryParams.minDuration = minDuration;
    }

    if (maxDuration) {
      conditions.push('duration_ms <= {maxDuration:UInt32}');
      queryParams.maxDuration = maxDuration;
    }

    if (path) {
      conditions.push('path LIKE {path:String}');
      queryParams.path = `%${path}%`;
    }

    if (hasError !== undefined) {
      if (hasError) {
        conditions.push('status_code >= 400');
      } else {
        conditions.push('status_code < 400');
      }
    }

    if (startDate) {
      conditions.push('timestamp >= {startDate:DateTime64(3)}');
      queryParams.startDate = startDate.toISOString();
    }

    if (endDate) {
      conditions.push('timestamp <= {endDate:DateTime64(3)}');
      queryParams.endDate = endDate.toISOString();
    }

    const whereClause = conditions.join(' AND ');
    const orderColumn = sortBy === 'duration_ms' ? 'duration_ms' : sortBy === 'status_code' ? 'status_code' : 'timestamp';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const [traces, totalResult] = await Promise.all([
      this.clickhouse.query<ClickHouseTrace>(
        `SELECT * FROM dex_monitoring.traces 
         WHERE ${whereClause}
         ORDER BY ${orderColumn} ${orderDir}
         LIMIT {take:UInt32} OFFSET {skip:UInt32}`,
        queryParams,
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.traces WHERE ${whereClause}`,
        queryParams,
      ),
    ]);

    return { data: traces, total: totalResult[0]?.count || 0 };
  }

  /**
   * Get a single trace by ID
   */
  async findById(id: string): Promise<ClickHouseTrace | null> {
    const traces = await this.clickhouse.query<ClickHouseTrace>(
      `SELECT * FROM dex_monitoring.traces WHERE id = {id:UUID} LIMIT 1`,
      { id },
    );
    return traces[0] || null;
  }

  /**
   * Get trace statistics (optimized with ClickHouse aggregations)
   */
  async getStats(
    projectId: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<TraceStats> {
    const cacheKey = `traces:stats:${projectId}:${startDate?.getTime() || 0}:${endDate?.getTime() || 0}`;
    const cached = await this.redis.get<TraceStats>(cacheKey);
    if (cached) return cached;

    const conditions: string[] = ['project_id = {projectId:String}'];
    const params: Record<string, unknown> = { projectId };

    if (startDate) {
      conditions.push('timestamp >= {startDate:DateTime64(3)}');
      params.startDate = startDate.toISOString();
    }

    if (endDate) {
      conditions.push('timestamp <= {endDate:DateTime64(3)}');
      params.endDate = endDate.toISOString();
    }

    const whereClause = conditions.join(' AND ');

    // Execute all stats queries in parallel
    const [
      basicStats,
      byMethodResult,
      byStatusResult,
      percentilesResult,
      slowestEndpoints,
    ] = await Promise.all([
      // Basic stats
      this.clickhouse.query<{
        total: number;
        avg_duration: number;
        error_count: number;
        min_time: string;
        max_time: string;
      }>(
        `SELECT 
           count() as total,
           avg(duration_ms) as avg_duration,
           countIf(status_code >= 400) as error_count,
           min(timestamp) as min_time,
           max(timestamp) as max_time
         FROM dex_monitoring.traces 
         WHERE ${whereClause}`,
        params,
      ),

      // By method
      this.clickhouse.query<{ method: string; count: number }>(
        `SELECT method, count() as count 
         FROM dex_monitoring.traces 
         WHERE ${whereClause}
         GROUP BY method`,
        params,
      ),

      // By status category
      this.clickhouse.query<{ status: string; count: number }>(
        `SELECT 
           concat(toString(intDiv(status_code, 100)), 'xx') as status,
           count() as count 
         FROM dex_monitoring.traces 
         WHERE ${whereClause}
         GROUP BY status`,
        params,
      ),

      // Percentiles
      this.clickhouse.query<{ p50: number; p95: number; p99: number }>(
        `SELECT 
           quantile(0.5)(duration_ms) as p50,
           quantile(0.95)(duration_ms) as p95,
           quantile(0.99)(duration_ms) as p99
         FROM dex_monitoring.traces 
         WHERE ${whereClause}`,
        params,
      ),

      // Slowest endpoints
      this.clickhouse.query<{
        path: string;
        method: string;
        avg_duration: number;
        count: number;
        error_rate: number;
      }>(
        `SELECT 
           path,
           method,
           avg(duration_ms) as avg_duration,
           count() as count,
           countIf(status_code >= 400) * 100.0 / count() as error_rate
         FROM dex_monitoring.traces 
         WHERE ${whereClause}
         GROUP BY path, method
         ORDER BY avg_duration DESC
         LIMIT 10`,
        params,
      ),
    ]);

    const stats = basicStats[0] || { total: 0, avg_duration: 0, error_count: 0 };
    const percentiles = percentilesResult[0] || { p50: 0, p95: 0, p99: 0 };

    // Calculate requests per minute
    let requestsPerMinute = 0;
    if (stats.total > 0 && basicStats[0]?.min_time && basicStats[0]?.max_time) {
      const timeRangeMs = new Date(basicStats[0].max_time).getTime() - new Date(basicStats[0].min_time).getTime();
      requestsPerMinute = timeRangeMs > 0 ? Math.round((stats.total / timeRangeMs) * 60000) : 0;
    }

    const byMethod: Record<string, number> = {};
    for (const row of byMethodResult) {
      byMethod[row.method] = row.count;
    }

    const byStatus: Record<string, number> = {};
    for (const row of byStatusResult) {
      byStatus[row.status] = row.count;
    }

    const result: TraceStats = {
      total: stats.total,
      byMethod,
      byStatus,
      avgDuration: Math.round(stats.avg_duration || 0),
      p50Duration: Math.round(percentiles.p50 || 0),
      p95Duration: Math.round(percentiles.p95 || 0),
      p99Duration: Math.round(percentiles.p99 || 0),
      errorRate: stats.total > 0 ? Math.round((stats.error_count / stats.total) * 100) : 0,
      requestsPerMinute,
      slowestEndpoints: slowestEndpoints.map(e => ({
        path: e.path,
        method: e.method,
        avgDuration: Math.round(e.avg_duration),
        count: e.count,
        errorRate: Math.round(e.error_rate),
      })),
    };

    await this.redis.set(cacheKey, result, 30);
    return result;
  }

  /**
   * Get traces timeline (for charts)
   */
  async getTimeline(
    projectId: string,
    startDate: Date,
    endDate: Date,
    interval: 'minute' | 'hour' | 'day' = 'hour',
  ): Promise<Array<{
    timestamp: string;
    count: number;
    avgDuration: number;
    errorCount: number;
  }>> {
    const cacheKey = `traces:timeline:${projectId}:${startDate.getTime()}:${endDate.getTime()}:${interval}`;
    const cached = await this.redis.get<Array<{
      timestamp: string;
      count: number;
      avgDuration: number;
      errorCount: number;
    }>>(cacheKey);
    if (cached) return cached;

    const intervalFunc = interval === 'minute' ? 'toStartOfMinute' : interval === 'day' ? 'toStartOfDay' : 'toStartOfHour';

    const result = await this.clickhouse.query<{
      timestamp: string;
      count: number;
      avg_duration: number;
      error_count: number;
    }>(
      `SELECT 
         ${intervalFunc}(timestamp) as timestamp,
         count() as count,
         avg(duration_ms) as avg_duration,
         countIf(status_code >= 400) as error_count
       FROM dex_monitoring.traces 
       WHERE project_id = {projectId:String}
       AND timestamp >= {startDate:DateTime64(3)}
       AND timestamp <= {endDate:DateTime64(3)}
       GROUP BY timestamp
       ORDER BY timestamp`,
      {
        projectId,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    );

    const timeline = result.map(r => ({
      timestamp: r.timestamp,
      count: r.count,
      avgDuration: Math.round(r.avg_duration),
      errorCount: r.error_count,
    }));

    await this.redis.set(cacheKey, timeline, 60);
    return timeline;
  }

  /**
   * Get live stats (real-time, no cache)
   */
  async getLiveStats(projectId: string): Promise<{
    requestsLastMinute: number;
    avgDurationLastMinute: number;
    errorsLastMinute: number;
  }> {
    const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();

    const result = await this.clickhouse.query<{
      count: number;
      avg_duration: number;
      errors: number;
    }>(
      `SELECT 
         count() as count,
         avg(duration_ms) as avg_duration,
         countIf(status_code >= 400) as errors
       FROM dex_monitoring.traces 
       WHERE project_id = {projectId:String}
       AND timestamp >= {since:DateTime64(3)}`,
      { projectId, since: oneMinuteAgo },
    );

    const stats = result[0] || { count: 0, avg_duration: 0, errors: 0 };

    return {
      requestsLastMinute: stats.count,
      avgDurationLastMinute: Math.round(stats.avg_duration || 0),
      errorsLastMinute: stats.errors,
    };
  }
}
