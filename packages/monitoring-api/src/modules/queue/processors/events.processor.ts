import { Process, Processor, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull';
import { Inject } from '@nestjs/common';
import { Job } from 'bull';
import { Logger } from '@dex-monit/observability-logger';
import { EventsClickHouseService } from '../../events/events-clickhouse.service.js';
import { EVENTS_QUEUE } from '../queue.module.js';
import type { EventJob } from '../queue.service.js';

@Processor(EVENTS_QUEUE)
export class EventsProcessor {
  constructor(
    private readonly eventsService: EventsClickHouseService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  @Process()
  async handleEvent(job: Job<EventJob>): Promise<void> {
    const { projectId, event } = job.data;

    this.logger.debug('Processing event', {
      jobId: job.id,
      eventId: event.eventId,
      projectId,
    });

    try {
      await this.eventsService.ingest(event, projectId);
    } catch (error) {
      this.logger.error('Failed to process event', {
        jobId: job.id,
        eventId: event.eventId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  @OnQueueCompleted()
  onCompleted(job: Job<EventJob>) {
    this.logger.debug('Event job completed', {
      jobId: job.id,
      eventId: job.data.event.eventId,
    });
  }

  @OnQueueFailed()
  onFailed(job: Job<EventJob>, error: Error) {
    this.logger.error('Event job failed', {
      jobId: job.id,
      eventId: job.data.event.eventId,
      error: error.message,
      attempts: job.attemptsMade,
    });
  }
}
