import { Injectable, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, JobOptions } from 'bull';
import { Logger } from '@dex-monit/observability-logger';
import { EVENTS_QUEUE, LOGS_QUEUE, TRACES_QUEUE, METRICS_QUEUE } from './queue.module.js';
import type { ErrorEvent, LogEvent } from '@dex-monit/observability-contracts';

export interface EventJob {
  projectId: string;
  event: ErrorEvent;
}

export interface LogJob {
  projectId: string;
  logs: Array<{
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
  }>;
}

export interface TraceJob {
  projectId: string;
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
  }>;
}

export interface MetricsJob {
  projectId: string;
  timestamp: Date;
  type: 'aggregate';
}

@Injectable()
export class QueueService {
  constructor(
    @InjectQueue(EVENTS_QUEUE) private readonly eventsQueue: Queue<EventJob>,
    @InjectQueue(LOGS_QUEUE) private readonly logsQueue: Queue<LogJob>,
    @InjectQueue(TRACES_QUEUE) private readonly tracesQueue: Queue<TraceJob>,
    @InjectQueue(METRICS_QUEUE) private readonly metricsQueue: Queue<MetricsJob>,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Add an error event to the queue
   */
  async queueEvent(projectId: string, event: ErrorEvent): Promise<string> {
    const job = await this.eventsQueue.add(
      { projectId, event },
      {
        priority: this.getPriority(event.level),
        jobId: event.eventId,
      },
    );
    return job.id as string;
  }

  /**
   * Add logs to the queue (batched)
   */
  async queueLogs(projectId: string, logs: LogJob['logs']): Promise<string> {
    const job = await this.logsQueue.add(
      { projectId, logs },
      {
        priority: 2, // Normal priority
      },
    );
    return job.id as string;
  }

  /**
   * Add traces to the queue (batched)
   */
  async queueTraces(projectId: string, traces: TraceJob['traces']): Promise<string> {
    const job = await this.tracesQueue.add(
      { projectId, traces },
      {
        priority: 2, // Normal priority
      },
    );
    return job.id as string;
  }

  /**
   * Schedule metrics aggregation
   */
  async scheduleMetricsAggregation(projectId: string): Promise<string> {
    const job = await this.metricsQueue.add(
      {
        projectId,
        timestamp: new Date(),
        type: 'aggregate',
      },
      {
        priority: 3, // Lower priority
        delay: 60000, // Delay 1 minute to batch more data
        jobId: `metrics-${projectId}-${Math.floor(Date.now() / 60000)}`, // Dedupe per minute
      },
    );
    return job.id as string;
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<{
    events: QueueStats;
    logs: QueueStats;
    traces: QueueStats;
    metrics: QueueStats;
  }> {
    const [events, logs, traces, metrics] = await Promise.all([
      this.getQueueInfo(this.eventsQueue),
      this.getQueueInfo(this.logsQueue),
      this.getQueueInfo(this.tracesQueue),
      this.getQueueInfo(this.metricsQueue),
    ]);

    return { events, logs, traces, metrics };
  }

  private async getQueueInfo(queue: Queue): Promise<QueueStats> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  }

  /**
   * Get priority based on severity level
   */
  private getPriority(level: string): number {
    const priorities: Record<string, number> = {
      fatal: 1,
      error: 1,
      warning: 2,
      info: 3,
      debug: 4,
    };
    return priorities[level.toLowerCase()] || 2;
  }

  /**
   * Pause all queues
   */
  async pauseAll(): Promise<void> {
    await Promise.all([
      this.eventsQueue.pause(),
      this.logsQueue.pause(),
      this.tracesQueue.pause(),
      this.metricsQueue.pause(),
    ]);
    this.logger.info('All queues paused');
  }

  /**
   * Resume all queues
   */
  async resumeAll(): Promise<void> {
    await Promise.all([
      this.eventsQueue.resume(),
      this.logsQueue.resume(),
      this.tracesQueue.resume(),
      this.metricsQueue.resume(),
    ]);
    this.logger.info('All queues resumed');
  }

  /**
   * Clean old jobs from all queues
   */
  async cleanOldJobs(olderThanMs: number = 24 * 60 * 60 * 1000): Promise<void> {
    await Promise.all([
      this.eventsQueue.clean(olderThanMs, 'completed'),
      this.eventsQueue.clean(olderThanMs, 'failed'),
      this.logsQueue.clean(olderThanMs, 'completed'),
      this.logsQueue.clean(olderThanMs, 'failed'),
      this.tracesQueue.clean(olderThanMs, 'completed'),
      this.tracesQueue.clean(olderThanMs, 'failed'),
      this.metricsQueue.clean(olderThanMs, 'completed'),
      this.metricsQueue.clean(olderThanMs, 'failed'),
    ]);
    this.logger.info('Old jobs cleaned from queues');
  }
}

interface QueueStats {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}
