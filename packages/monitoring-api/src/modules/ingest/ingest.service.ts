import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@dex-monit/observability-logger';
import { EventsClickHouseService, IngestResult } from '../events/events-clickhouse.service.js';
import { LogsClickHouseService } from '../logs/logs-clickhouse.service.js';
import { TracesClickHouseService } from '../traces/traces-clickhouse.service.js';
import { AlertsService } from '../alerts/alerts.service.js';
import { RedisService } from '../redis/redis.service.js';
import type { ErrorEvent, LogEvent } from '@dex-monit/observability-contracts';

// Configuration
const RATE_LIMIT_EVENTS = parseInt(process.env['RATE_LIMIT_EVENTS'] || '10000', 10);
const RATE_LIMIT_LOGS = parseInt(process.env['RATE_LIMIT_LOGS'] || '100000', 10);
const RATE_LIMIT_TRACES = parseInt(process.env['RATE_LIMIT_TRACES'] || '100000', 10);
const RATE_LIMIT_WINDOW = 60; // seconds

@Injectable()
export class IngestService {
  constructor(
    private readonly eventsService: EventsClickHouseService,
    private readonly logsService: LogsClickHouseService,
    private readonly tracesService: TracesClickHouseService,
    private readonly alertsService: AlertsService,
    private readonly redis: RedisService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Ingest an error event → ClickHouse
   */
  async ingestError(event: ErrorEvent, projectId: string): Promise<IngestResult> {
    // Rate limiting (optional - works without Redis)
    const rateCheck = await this.redis.checkRateLimit(
      `events:${projectId}`,
      RATE_LIMIT_EVENTS,
      RATE_LIMIT_WINDOW,
    );

    if (!rateCheck.allowed) {
      this.logger.warn('Rate limit exceeded for events', {
        projectId,
        remaining: rateCheck.remaining,
        resetIn: rateCheck.resetIn,
      });
    }

    // Ingest to ClickHouse
    const result = await this.eventsService.ingest(event, projectId);

    // Check alerts asynchronously (fire and forget)
    this.checkAlertsAsync(projectId, result).catch((err) => {
      this.logger.error('Failed to check alerts', { error: err.message });
    });

    this.logger.info('Error event ingested to ClickHouse', {
      eventId: result.eventId,
      issueId: result.issueId,
      isNewIssue: result.isNewIssue,
    });

    return result;
  }

  /**
   * Check alerts asynchronously
   */
  private async checkAlertsAsync(projectId: string, result: IngestResult): Promise<void> {
    try {
      await this.alertsService.checkThreshold(projectId);
    } catch (error) {
      this.logger.error('Failed to check alerts', {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Ingest a log event → ClickHouse
   */
  async ingestLog(log: LogEvent, projectId: string): Promise<{ id: string }> {
    // Rate limiting
    const rateCheck = await this.redis.checkRateLimit(
      `logs:${projectId}`,
      RATE_LIMIT_LOGS,
      RATE_LIMIT_WINDOW,
    );

    if (!rateCheck.allowed) {
      this.logger.warn('Rate limit exceeded for logs', { projectId });
    }

    // Ingest to ClickHouse
    const id = await this.logsService.ingest(projectId, {
      level: log.level,
      message: log.message,
      logger: log.logger,
      environment: log.environment,
      service: log.serverName,
      host: log.serverName,
      requestId: log.requestId,
      transactionId: log.transactionId,
      attributes: log.data as Record<string, unknown>,
      timestamp: log.timestamp,
    });

    this.logger.debug('Log ingested to ClickHouse', { logId: id, level: log.level });

    return { id };
  }

  /**
   * Batch ingest multiple logs → ClickHouse
   */
  async ingestLogs(logs: LogEvent[], projectId: string): Promise<{ count: number }> {
    if (logs.length === 0) {
      return { count: 0 };
    }

    // Rate limiting
    const rateCheck = await this.redis.checkRateLimit(
      `logs:${projectId}`,
      RATE_LIMIT_LOGS,
      RATE_LIMIT_WINDOW,
    );

    if (!rateCheck.allowed) {
      this.logger.warn('Rate limit exceeded for logs batch', {
        projectId,
        batchSize: logs.length,
      });
    }

    const mappedLogs = logs.map((log) => ({
      level: log.level,
      message: log.message,
      logger: log.logger,
      environment: log.environment,
      service: log.serverName,
      host: log.serverName,
      requestId: log.requestId,
      transactionId: log.transactionId,
      attributes: log.data as Record<string, unknown>,
      timestamp: log.timestamp,
    }));

    // Batch insert to ClickHouse
    const count = await this.logsService.ingestBatch(projectId, mappedLogs);

    this.logger.info('Batch logs ingested to ClickHouse', { count });

    return { count };
  }

  /**
   * Ingest HTTP traces → ClickHouse
   */
  async ingestTraces(
    traces: Array<{
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
    }>,
    projectId: string,
  ): Promise<{ count: number }> {
    if (traces.length === 0) {
      return { count: 0 };
    }

    // Rate limiting
    const rateCheck = await this.redis.checkRateLimit(
      `traces:${projectId}`,
      RATE_LIMIT_TRACES,
      RATE_LIMIT_WINDOW,
    );

    if (!rateCheck.allowed) {
      this.logger.warn('Rate limit exceeded for traces', {
        projectId,
        batchSize: traces.length,
      });
    }

    // Batch insert to ClickHouse
    const count = await this.tracesService.ingestBatch(projectId, traces);

    this.logger.info('HTTP traces ingested to ClickHouse', { count });

    return { count };
  }
}
