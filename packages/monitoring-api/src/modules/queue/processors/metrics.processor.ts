import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Inject } from '@nestjs/common';
import { Job } from 'bull';
import { Logger } from '@dex-monit/observability-logger';
import { ClickHouseService } from '../../clickhouse/clickhouse.service.js';
import { METRICS_QUEUE } from '../queue.module.js';
import type { MetricsJob } from '../queue.service.js';

@Processor(METRICS_QUEUE)
export class MetricsProcessor {
  constructor(
    private readonly clickhouse: ClickHouseService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  @Process()
  async handleMetrics(job: Job<MetricsJob>): Promise<void> {
    const { projectId, timestamp, type } = job.data;

    this.logger.debug('Processing metrics aggregation', {
      jobId: job.id,
      projectId,
      type,
      timestamp: timestamp.toISOString(),
    });

    if (type === 'aggregate') {
      await this.aggregateMetrics(projectId, timestamp);
    }
  }

  /**
   * Aggregate metrics for the last minute
   */
  private async aggregateMetrics(projectId: string, timestamp: Date): Promise<void> {
    const minuteStart = new Date(Math.floor(timestamp.getTime() / 60000) * 60000);
    const minuteEnd = new Date(minuteStart.getTime() + 60000);

    try {
      // Aggregate events
      const eventsAgg = await this.clickhouse.query<{
        error_count: number;
        warning_count: number;
      }>(
        `SELECT 
           countIf(level IN ('ERROR', 'FATAL')) as error_count,
           countIf(level = 'WARNING') as warning_count
         FROM dex_monitoring.events 
         WHERE project_id = {projectId:String}
         AND timestamp >= {start:DateTime64(3)}
         AND timestamp < {end:DateTime64(3)}`,
        {
          projectId,
          start: minuteStart.toISOString(),
          end: minuteEnd.toISOString(),
        },
      );

      // Aggregate logs
      const logsAgg = await this.clickhouse.query<{ log_count: number }>(
        `SELECT count() as log_count
         FROM dex_monitoring.logs 
         WHERE project_id = {projectId:String}
         AND timestamp >= {start:DateTime64(3)}
         AND timestamp < {end:DateTime64(3)}`,
        {
          projectId,
          start: minuteStart.toISOString(),
          end: minuteEnd.toISOString(),
        },
      );

      // Aggregate traces
      const tracesAgg = await this.clickhouse.query<{
        request_count: number;
        avg_duration: number;
        p50_duration: number;
        p95_duration: number;
        p99_duration: number;
        status_2xx: number;
        status_3xx: number;
        status_4xx: number;
        status_5xx: number;
      }>(
        `SELECT 
           count() as request_count,
           avg(duration_ms) as avg_duration,
           quantile(0.5)(duration_ms) as p50_duration,
           quantile(0.95)(duration_ms) as p95_duration,
           quantile(0.99)(duration_ms) as p99_duration,
           countIf(status_code >= 200 AND status_code < 300) as status_2xx,
           countIf(status_code >= 300 AND status_code < 400) as status_3xx,
           countIf(status_code >= 400 AND status_code < 500) as status_4xx,
           countIf(status_code >= 500) as status_5xx
         FROM dex_monitoring.traces 
         WHERE project_id = {projectId:String}
         AND timestamp >= {start:DateTime64(3)}
         AND timestamp < {end:DateTime64(3)}`,
        {
          projectId,
          start: minuteStart.toISOString(),
          end: minuteEnd.toISOString(),
        },
      );

      const events = eventsAgg[0] || { error_count: 0, warning_count: 0 };
      const logs = logsAgg[0] || { log_count: 0 };
      const traces = tracesAgg[0] || {
        request_count: 0,
        avg_duration: 0,
        p50_duration: 0,
        p95_duration: 0,
        p99_duration: 0,
        status_2xx: 0,
        status_3xx: 0,
        status_4xx: 0,
        status_5xx: 0,
      };

      // Calculate error rate
      const totalRequests = traces.request_count || 0;
      const errorRequests = (traces.status_4xx || 0) + (traces.status_5xx || 0);
      const errorRate = totalRequests > 0 ? (errorRequests / totalRequests) * 100 : 0;

      // Insert aggregated metrics
      await this.clickhouse.insert('metrics_1m', [{
        project_id: projectId,
        timestamp: minuteStart.toISOString(),
        error_count: events.error_count || 0,
        warning_count: events.warning_count || 0,
        request_count: traces.request_count || 0,
        avg_duration_ms: traces.avg_duration || 0,
        p50_duration_ms: traces.p50_duration || 0,
        p95_duration_ms: traces.p95_duration || 0,
        p99_duration_ms: traces.p99_duration || 0,
        error_rate: errorRate,
        log_count: logs.log_count || 0,
        status_2xx: traces.status_2xx || 0,
        status_3xx: traces.status_3xx || 0,
        status_4xx: traces.status_4xx || 0,
        status_5xx: traces.status_5xx || 0,
      }]);

      this.logger.debug('Metrics aggregated', {
        projectId,
        timestamp: minuteStart.toISOString(),
        requestCount: traces.request_count,
        errorCount: events.error_count,
        logCount: logs.log_count,
      });
    } catch (error) {
      this.logger.error('Failed to aggregate metrics', {
        projectId,
        timestamp: minuteStart.toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job<MetricsJob>) {
    this.logger.debug('Metrics job completed', {
      jobId: job.id,
      projectId: job.data.projectId,
    });
  }

  @OnQueueFailed()
  onFailed(job: Job<MetricsJob>, error: Error) {
    this.logger.error('Metrics job failed', {
      jobId: job.id,
      projectId: job.data.projectId,
      error: error.message,
      attempts: job.attemptsMade,
    });
  }
}
