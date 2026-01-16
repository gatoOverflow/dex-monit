import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Inject } from '@nestjs/common';
import { Job } from 'bull';
import { Logger } from '@dex-monit/observability-logger';
import { TracesClickHouseService } from '../../traces/traces-clickhouse.service.js';
import { TRACES_QUEUE } from '../queue.module.js';
import type { TraceJob } from '../queue.service.js';

@Processor(TRACES_QUEUE)
export class TracesProcessor {
  constructor(
    private readonly tracesService: TracesClickHouseService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  @Process()
  async handleTraces(job: Job<TraceJob>): Promise<void> {
    const { projectId, traces } = job.data;

    this.logger.debug('Processing traces batch', {
      jobId: job.id,
      projectId,
      count: traces.length,
    });

    try {
      await this.tracesService.ingestBatch(projectId, traces);
    } catch (error) {
      this.logger.error('Failed to process traces', {
        jobId: job.id,
        projectId,
        count: traces.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job<TraceJob>) {
    this.logger.debug('Traces job completed', {
      jobId: job.id,
      projectId: job.data.projectId,
      count: job.data.traces.length,
    });
  }

  @OnQueueFailed()
  onFailed(job: Job<TraceJob>, error: Error) {
    this.logger.error('Traces job failed', {
      jobId: job.id,
      projectId: job.data.projectId,
      count: job.data.traces.length,
      error: error.message,
      attempts: job.attemptsMade,
    });
  }
}
