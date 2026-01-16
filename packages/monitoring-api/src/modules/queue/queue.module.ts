import { Module, Global, DynamicModule, Logger } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

export const EVENTS_QUEUE = 'events-queue';
export const LOGS_QUEUE = 'logs-queue';
export const TRACES_QUEUE = 'traces-queue';
export const METRICS_QUEUE = 'metrics-queue';

// Check if Redis is enabled
const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true' || process.env['ASYNC_INGESTION'] === 'true';

@Global()
@Module({})
export class QueueModule {
  private static readonly logger = new Logger('QueueModule');

  static forRoot(): DynamicModule {
    // If Redis is not enabled, return empty module
    if (!REDIS_ENABLED) {
      this.logger.warn('Queue module disabled (REDIS_ENABLED or ASYNC_INGESTION not set to true)');
      return {
        module: QueueModule,
        providers: [
          {
            provide: 'QueueService',
            useValue: {
              queueEvent: async () => 'disabled',
              queueLogs: async () => 'disabled',
              queueTraces: async () => 'disabled',
              scheduleMetricsAggregation: async () => 'disabled',
              getQueueStats: async () => ({
                events: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                logs: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                traces: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
                metrics: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
              }),
              pauseAll: async () => {},
              resumeAll: async () => {},
              cleanOldJobs: async () => {},
            },
          },
        ],
        exports: ['QueueService'],
      };
    }

    // Full Bull queue configuration when Redis is enabled
    return {
      module: QueueModule,
      imports: [
        BullModule.forRoot({
          redis: {
            host: process.env['REDIS_HOST'] || 'localhost',
            port: parseInt(process.env['REDIS_PORT'] || '6379', 10),
            password: process.env['REDIS_PASSWORD'] || undefined,
          },
          defaultJobOptions: {
            removeOnComplete: 100,
            removeOnFail: 1000,
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
          },
        }),
        BullModule.registerQueue(
          { name: EVENTS_QUEUE },
          { name: LOGS_QUEUE },
          { name: TRACES_QUEUE },
          { name: METRICS_QUEUE },
        ),
      ],
      providers: [],
      exports: [BullModule],
    };
  }
}
