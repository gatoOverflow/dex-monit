import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { Logger } from '@dex-monit/observability-logger';
import { PrismaService } from '../database/prisma.service.js';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';

interface RetentionConfig {
  events: number;   // Days to keep events
  logs: number;     // Days to keep logs
  traces: number;   // Days to keep traces
  sessions: number; // Days to keep sessions
}

@Injectable()
export class CleanupService implements OnModuleInit {
  private readonly config: RetentionConfig;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(
    @Inject(Logger) private readonly logger: Logger,
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
  ) {
    // Load configuration from environment
    this.config = {
      events: parseInt(process.env['RETENTION_EVENTS_DAYS'] || '90', 10),
      logs: parseInt(process.env['RETENTION_LOGS_DAYS'] || '30', 10),
      traces: parseInt(process.env['RETENTION_TRACES_DAYS'] || '14', 10),
      sessions: parseInt(process.env['RETENTION_SESSIONS_DAYS'] || '90', 10),
    };
  }

  async onModuleInit(): Promise<void> {
    const enabled = process.env['CLEANUP_ENABLED'] === 'true';
    if (!enabled) {
      this.logger.info('Data cleanup disabled (set CLEANUP_ENABLED=true to enable)');
      return;
    }

    // Run cleanup on startup
    this.logger.info('Data cleanup enabled', { config: this.config });
    await this.runCleanup();

    // Schedule periodic cleanup (every 6 hours)
    const intervalMs = parseInt(process.env['CLEANUP_INTERVAL_MS'] || String(6 * 60 * 60 * 1000), 10);
    this.intervalId = setInterval(() => {
      this.runCleanup().catch((err) => {
        this.logger.error('Scheduled cleanup failed', { error: err.message });
      });
    }, intervalMs);

    this.logger.info('Scheduled cleanup every ' + (intervalMs / 3600000).toFixed(1) + ' hours');
  }

  /**
   * Run cleanup for all data types
   */
  async runCleanup(): Promise<void> {
    this.logger.info('Starting data cleanup');
    const startTime = Date.now();

    const results = {
      events: 0,
      logs: 0,
      traces: 0,
      sessions: 0,
    };

    try {
      // Cleanup events
      results.events = await this.cleanupEvents();

      // Cleanup logs
      results.logs = await this.cleanupLogs();

      // Cleanup traces
      results.traces = await this.cleanupTraces();

      // Cleanup sessions
      results.sessions = await this.cleanupSessions();

      const duration = Date.now() - startTime;
      this.logger.info('Data cleanup completed', {
        duration: `${duration}ms`,
        deleted: results,
      });
    } catch (error) {
      this.logger.error('Data cleanup failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        results,
      });
    }
  }

  /**
   * Cleanup old events
   */
  private async cleanupEvents(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.events);

    // Cleanup from PostgreSQL
    const result = await this.prisma.event.deleteMany({
      where: { timestamp: { lt: cutoffDate } },
    });

    // Cleanup from ClickHouse (TTL handles this automatically, but we can force it)
    if (this.clickhouse.isConnected()) {
      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.events
        DELETE WHERE timestamp < toDateTime64('${cutoffDate.toISOString().replace('T', ' ').replace('Z', '')}', 3)
      `);
    }

    return result.count;
  }

  /**
   * Cleanup old logs
   */
  private async cleanupLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.logs);

    // Cleanup from PostgreSQL
    const result = await this.prisma.log.deleteMany({
      where: { timestamp: { lt: cutoffDate } },
    });

    // Cleanup from ClickHouse
    if (this.clickhouse.isConnected()) {
      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.logs
        DELETE WHERE timestamp < toDateTime64('${cutoffDate.toISOString().replace('T', ' ').replace('Z', '')}', 3)
      `);
    }

    return result.count;
  }

  /**
   * Cleanup old HTTP traces
   */
  private async cleanupTraces(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.traces);

    // Cleanup from PostgreSQL
    const result = await this.prisma.httpTrace.deleteMany({
      where: { timestamp: { lt: cutoffDate } },
    });

    // Cleanup from ClickHouse
    if (this.clickhouse.isConnected()) {
      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.traces
        DELETE WHERE timestamp < toDateTime64('${cutoffDate.toISOString().replace('T', ' ').replace('Z', '')}', 3)
      `);
    }

    return result.count;
  }

  /**
   * Cleanup old sessions
   */
  private async cleanupSessions(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.sessions);

    // Cleanup from ClickHouse (sessions are stored in ClickHouse)
    if (this.clickhouse.isConnected()) {
      const result = await this.clickhouse.query<{ count: string }>(`
        SELECT count() as count FROM dex_monitoring.sessions
        WHERE started_at < toDateTime64('${cutoffDate.toISOString().replace('T', ' ').replace('Z', '')}', 3)
      `);

      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.sessions
        DELETE WHERE started_at < toDateTime64('${cutoffDate.toISOString().replace('T', ' ').replace('Z', '')}', 3)
      `);

      // Also cleanup page views
      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.page_views
        DELETE WHERE timestamp < toDateTime64('${cutoffDate.toISOString().replace('T', ' ').replace('Z', '')}', 3)
      `);

      // Cleanup user activity
      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.user_activity
        DELETE WHERE timestamp < toDateTime64('${cutoffDate.toISOString().replace('T', ' ').replace('Z', '')}', 3)
      `);

      return parseInt(result[0]?.count || '0', 10);
    }

    return 0;
  }

  /**
   * Get current retention configuration
   */
  getConfig(): RetentionConfig {
    return { ...this.config };
  }

  /**
   * Get storage usage stats
   */
  async getStorageStats(): Promise<{
    events: { count: number; oldestDate?: Date };
    logs: { count: number; oldestDate?: Date };
    traces: { count: number; oldestDate?: Date };
  }> {
    const [eventsCount, logsCount, tracesCount, oldestEvent, oldestLog, oldestTrace] =
      await Promise.all([
        this.prisma.event.count(),
        this.prisma.log.count(),
        this.prisma.httpTrace.count(),
        this.prisma.event.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
        this.prisma.log.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
        this.prisma.httpTrace.findFirst({ orderBy: { timestamp: 'asc' }, select: { timestamp: true } }),
      ]);

    return {
      events: {
        count: eventsCount,
        oldestDate: oldestEvent?.timestamp,
      },
      logs: {
        count: logsCount,
        oldestDate: oldestLog?.timestamp,
      },
      traces: {
        count: tracesCount,
        oldestDate: oldestTrace?.timestamp,
      },
    };
  }
}
