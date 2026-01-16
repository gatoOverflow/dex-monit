import { Injectable, OnModuleInit, OnModuleDestroy, Inject } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Logger } from '@dex-monit/observability-logger';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(Logger) private readonly logger: Logger) {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'error' },
        { emit: 'event', level: 'warn' },
      ],
    });
  }

  async onModuleInit() {
    // Log queries in development
    if (process.env['NODE_ENV'] === 'development') {
      // @ts-expect-error Prisma event types
      this.$on('query', (e: { query: string; duration: number }) => {
        this.logger.debug('Prisma Query', {
          query: e.query,
          duration: `${e.duration}ms`,
        });
      });
    }

    await this.$connect();
    this.logger.info('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.info('Database disconnected');
  }

  /**
   * Clean database - for testing only
   */
  async cleanDatabase() {
    if (process.env['NODE_ENV'] !== 'test') {
      throw new Error('cleanDatabase can only be used in test environment');
    }

    const tablenames = await this.$queryRaw<
      Array<{ tablename: string }>
    >`SELECT tablename FROM pg_tables WHERE schemaname='public'`;

    for (const { tablename } of tablenames) {
      if (tablename !== '_prisma_migrations') {
        await this.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`);
      }
    }
  }
}
