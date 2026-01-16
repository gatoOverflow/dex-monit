import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Inject } from '@nestjs/common';
import { Job } from 'bull';
import { Logger } from '@dex-monit/observability-logger';
import { LogsClickHouseService } from '../../logs/logs-clickhouse.service.js';
import { LOGS_QUEUE } from '../queue.module.js';
import type { LogJob } from '../queue.service.js';

@Processor(LOGS_QUEUE)
export class LogsProcessor {
  constructor(
    private readonly logsService: LogsClickHouseService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  @Process()
  async handleLogs(job: Job<LogJob>): Promise<void> {
    const { projectId, logs } = job.data;

    this.logger.debug('Processing logs batch', {
      jobId: job.id,
      projectId,
      count: logs.length,
    });

    try {
      await this.logsService.ingestBatch(projectId, logs);
    } catch (error) {
      this.logger.error('Failed to process logs', {
        jobId: job.id,
        projectId,
        count: logs.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job<LogJob>) {
    this.logger.debug('Logs job completed', {
      jobId: job.id,
      projectId: job.data.projectId,
      count: job.data.logs.length,
    });
  }

  @OnQueueFailed()
  onFailed(job: Job<LogJob>, error: Error) {
    this.logger.error('Logs job failed', {
      jobId: job.id,
      projectId: job.data.projectId,
      count: job.data.logs.length,
      error: error.message,
      attempts: job.attemptsMade,
    });
  }
}
