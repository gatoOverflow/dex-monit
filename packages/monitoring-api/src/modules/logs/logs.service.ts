import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import type { Log, Severity, Prisma } from '@prisma/client';

export interface ListLogsParams {
  projectId?: string;
  level?: Severity;
  environment?: string;
  requestId?: string;
  transactionId?: string;
  search?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
}

@Injectable()
export class LogsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async list(params: ListLogsParams): Promise<{ data: Log[]; total: number }> {
    const {
      projectId,
      level,
      environment,
      requestId,
      transactionId,
      search,
      from,
      to,
      skip = 0,
      take = 100,
    } = params;

    const where: Prisma.LogWhereInput = {
      ...(projectId && { projectId }),
      ...(level && { level }),
      ...(environment && { environment }),
      ...(requestId && { requestId }),
      ...(transactionId && { transactionId }),
      ...(search && {
        message: { contains: search, mode: 'insensitive' },
      }),
      ...((from || to) && {
        timestamp: {
          ...(from && { gte: from }),
          ...(to && { lte: to }),
        },
      }),
    };

    const [logs, total] = await Promise.all([
      this.prisma.log.findMany({
        where,
        skip,
        take,
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.log.count({ where }),
    ]);

    return { data: logs, total };
  }

  async findById(id: string): Promise<Log | null> {
    return this.prisma.log.findUnique({ where: { id } });
  }

  async findByRequestId(requestId: string): Promise<Log[]> {
    return this.prisma.log.findMany({
      where: { requestId },
      orderBy: { timestamp: 'asc' },
    });
  }

  async findByTransactionId(transactionId: string): Promise<Log[]> {
    return this.prisma.log.findMany({
      where: { transactionId },
      orderBy: { timestamp: 'asc' },
    });
  }

  async getStats(projectId: string, timeRange: { from: Date; to: Date }) {
    const { from, to } = timeRange;

    const [byLevel, total] = await Promise.all([
      this.prisma.log.groupBy({
        by: ['level'],
        where: {
          projectId,
          timestamp: { gte: from, lte: to },
        },
        _count: true,
      }),
      this.prisma.log.count({
        where: {
          projectId,
          timestamp: { gte: from, lte: to },
        },
      }),
    ]);

    const levelCounts = byLevel.reduce(
      (acc, item) => {
        acc[item.level] = item._count;
        return acc;
      },
      {} as Record<string, number>
    );

    return {
      total,
      byLevel: levelCounts,
    };
  }

  /**
   * Delete old logs (for retention policy)
   */
  async deleteOlderThan(projectId: string, date: Date): Promise<number> {
    const result = await this.prisma.log.deleteMany({
      where: {
        projectId,
        timestamp: { lt: date },
      },
    });

    this.logger.info('Old logs deleted', {
      projectId,
      count: result.count,
      olderThan: date.toISOString(),
    });

    return result.count;
  }
}
