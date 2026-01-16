import { Injectable, Inject } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Logger } from '@dex-monit/observability-logger';

export interface ClickHouseLog {
  id: string;
  project_id: string;
  timestamp: string;
  received_at: string;
  level: string;
  message: string;
  logger: string;
  environment: string;
  service: string;
  host: string;
  request_id: string;
  transaction_id: string;
  user_id: string;
  attributes: string;
}

export interface CreateLogDto {
  level: string;
  message: string;
  logger?: string;
  environment?: string;
  service?: string;
  host?: string;
  requestId?: string;
  transactionId?: string;
  userId?: string;
  attributes?: Record<string, unknown>;
  timestamp?: string;
}

export interface ListLogsParams {
  projectId?: string;
  level?: string;
  environment?: string;
  service?: string;
  requestId?: string;
  transactionId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class LogsClickHouseService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly redis: RedisService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Ingest a single log entry
   */
  async ingest(projectId: string, log: CreateLogDto): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = log.timestamp || new Date().toISOString();

    await this.clickhouse.insert('logs', [{
      id,
      project_id: projectId,
      timestamp,
      level: log.level.toUpperCase(),
      message: log.message,
      logger: log.logger || '',
      environment: log.environment || 'production',
      service: log.service || '',
      host: log.host || '',
      request_id: log.requestId || '',
      transaction_id: log.transactionId || '',
      user_id: log.userId || '',
      attributes: JSON.stringify(log.attributes || {}),
    }]);

    // Invalidate stats cache
    await this.redis.delPattern(`logs:stats:${projectId}:*`);

    return id;
  }

  /**
   * Batch ingest multiple logs
   */
  async ingestBatch(projectId: string, logs: CreateLogDto[]): Promise<number> {
    if (logs.length === 0) return 0;

    const records = logs.map(log => ({
      id: crypto.randomUUID(),
      project_id: projectId,
      timestamp: log.timestamp || new Date().toISOString(),
      level: log.level.toUpperCase(),
      message: log.message,
      logger: log.logger || '',
      environment: log.environment || 'production',
      service: log.service || '',
      host: log.host || '',
      request_id: log.requestId || '',
      transaction_id: log.transactionId || '',
      user_id: log.userId || '',
      attributes: JSON.stringify(log.attributes || {}),
    }));

    await this.clickhouse.insert('logs', records);

    // Invalidate stats cache
    await this.redis.delPattern(`logs:stats:${projectId}:*`);

    return records.length;
  }

  /**
   * List logs with filtering
   */
  async list(params: ListLogsParams): Promise<{ data: ClickHouseLog[]; total: number }> {
    const {
      projectId,
      level,
      environment,
      service,
      requestId,
      transactionId,
      search,
      from,
      to,
      skip = 0,
      take = 100,
    } = params;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = { skip, take };

    if (projectId) {
      conditions.push('project_id = {projectId:String}');
      queryParams.projectId = projectId;
    }

    if (level) {
      conditions.push('level = {level:String}');
      queryParams.level = level.toUpperCase();
    }

    if (environment) {
      conditions.push('environment = {environment:String}');
      queryParams.environment = environment;
    }

    if (service) {
      conditions.push('service = {service:String}');
      queryParams.service = service;
    }

    if (requestId) {
      conditions.push('request_id = {requestId:String}');
      queryParams.requestId = requestId;
    }

    if (transactionId) {
      conditions.push('transaction_id = {transactionId:String}');
      queryParams.transactionId = transactionId;
    }

    if (search) {
      conditions.push('message ILIKE {search:String}');
      queryParams.search = `%${search}%`;
    }

    if (from) {
      conditions.push('timestamp >= {from:DateTime64(3)}');
      queryParams.from = from.toISOString();
    }

    if (to) {
      conditions.push('timestamp <= {to:DateTime64(3)}');
      queryParams.to = to.toISOString();
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [logs, totalResult] = await Promise.all([
      this.clickhouse.query<ClickHouseLog>(
        `SELECT * FROM dex_monitoring.logs 
         ${whereClause}
         ORDER BY timestamp DESC
         LIMIT {take:UInt32} OFFSET {skip:UInt32}`,
        queryParams,
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.logs ${whereClause}`,
        queryParams,
      ),
    ]);

    return { data: logs, total: totalResult[0]?.count || 0 };
  }

  /**
   * Get a single log by ID
   */
  async findById(id: string): Promise<ClickHouseLog | null> {
    const logs = await this.clickhouse.query<ClickHouseLog>(
      `SELECT * FROM dex_monitoring.logs WHERE id = {id:UUID} LIMIT 1`,
      { id },
    );
    return logs[0] || null;
  }

  /**
   * Get logs by request ID (for request tracing)
   */
  async findByRequestId(requestId: string): Promise<ClickHouseLog[]> {
    return this.clickhouse.query<ClickHouseLog>(
      `SELECT * FROM dex_monitoring.logs 
       WHERE request_id = {requestId:String}
       ORDER BY timestamp ASC`,
      { requestId },
    );
  }

  /**
   * Get logs by transaction ID
   */
  async findByTransactionId(transactionId: string): Promise<ClickHouseLog[]> {
    return this.clickhouse.query<ClickHouseLog>(
      `SELECT * FROM dex_monitoring.logs 
       WHERE transaction_id = {transactionId:String}
       ORDER BY timestamp ASC`,
      { transactionId },
    );
  }

  /**
   * Get log statistics
   */
  async getStats(
    projectId: string,
    timeRange: { from: Date; to: Date },
  ): Promise<{
    total: number;
    byLevel: Record<string, number>;
    byService: Record<string, number>;
    byHour: Array<{ hour: string; count: number }>;
    logsPerMinute: number;
  }> {
    const cacheKey = `logs:stats:${projectId}:${timeRange.from.getTime()}:${timeRange.to.getTime()}`;
    const cached = await this.redis.get<{
      total: number;
      byLevel: Record<string, number>;
      byService: Record<string, number>;
      byHour: Array<{ hour: string; count: number }>;
      logsPerMinute: number;
    }>(cacheKey);
    if (cached) return cached;

    const params = {
      projectId,
      from: timeRange.from.toISOString(),
      to: timeRange.to.toISOString(),
    };

    const [totalResult, byLevelResult, byServiceResult, byHourResult] = await Promise.all([
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}`,
        params,
      ),
      this.clickhouse.query<{ level: string; count: number }>(
        `SELECT level, count() as count FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}
         GROUP BY level`,
        params,
      ),
      this.clickhouse.query<{ service: string; count: number }>(
        `SELECT service, count() as count FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}
         AND service != ''
         GROUP BY service
         ORDER BY count DESC
         LIMIT 10`,
        params,
      ),
      this.clickhouse.query<{ hour: string; count: number }>(
        `SELECT toStartOfHour(timestamp) as hour, count() as count 
         FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}
         GROUP BY hour
         ORDER BY hour`,
        params,
      ),
    ]);

    const byLevel: Record<string, number> = {};
    for (const row of byLevelResult) {
      byLevel[row.level] = row.count;
    }

    const byService: Record<string, number> = {};
    for (const row of byServiceResult) {
      byService[row.service] = row.count;
    }

    const total = totalResult[0]?.count || 0;
    const timeRangeMs = timeRange.to.getTime() - timeRange.from.getTime();
    const logsPerMinute = timeRangeMs > 0 ? Math.round((total / timeRangeMs) * 60000) : 0;

    const result = {
      total,
      byLevel,
      byService,
      byHour: byHourResult,
      logsPerMinute,
    };

    await this.redis.set(cacheKey, result, 60);
    return result;
  }

  /**
   * Search logs with full-text search
   */
  async search(
    projectId: string,
    query: string,
    params: { from?: Date; to?: Date; take?: number },
  ): Promise<ClickHouseLog[]> {
    const { from, to, take = 100 } = params;

    const conditions: string[] = ['project_id = {projectId:String}'];
    const queryParams: Record<string, unknown> = { projectId, query: `%${query}%`, take };

    if (from) {
      conditions.push('timestamp >= {from:DateTime64(3)}');
      queryParams.from = from.toISOString();
    }

    if (to) {
      conditions.push('timestamp <= {to:DateTime64(3)}');
      queryParams.to = to.toISOString();
    }

    conditions.push('(message ILIKE {query:String} OR attributes ILIKE {query:String})');

    return this.clickhouse.query<ClickHouseLog>(
      `SELECT * FROM dex_monitoring.logs 
       WHERE ${conditions.join(' AND ')}
       ORDER BY timestamp DESC
       LIMIT {take:UInt32}`,
      queryParams,
    );
  }

  /**
   * Get unique values for filtering
   */
  async getFilterOptions(
    projectId: string,
  ): Promise<{
    levels: string[];
    environments: string[];
    services: string[];
  }> {
    const cacheKey = `logs:filters:${projectId}`;
    const cached = await this.redis.get<{
      levels: string[];
      environments: string[];
      services: string[];
    }>(cacheKey);
    if (cached) return cached;

    const [levels, environments, services] = await Promise.all([
      this.clickhouse.query<{ level: string }>(
        `SELECT DISTINCT level FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}`,
        { projectId },
      ),
      this.clickhouse.query<{ environment: string }>(
        `SELECT DISTINCT environment FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}
         AND environment != ''`,
        { projectId },
      ),
      this.clickhouse.query<{ service: string }>(
        `SELECT DISTINCT service FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}
         AND service != ''`,
        { projectId },
      ),
    ]);

    const result = {
      levels: levels.map(r => r.level),
      environments: environments.map(r => r.environment),
      services: services.map(r => r.service),
    };

    await this.redis.set(cacheKey, result, 300);
    return result;
  }
}
