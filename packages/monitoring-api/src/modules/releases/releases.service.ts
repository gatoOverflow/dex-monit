import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import type { Release, Prisma } from '@prisma/client';

export interface CreateReleaseDto {
  projectId: string;
  version: string;
  environment?: string;
  commitHash?: string;
  commitUrl?: string;
  deployedAt?: Date;
}

@Injectable()
export class ReleasesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async create(data: CreateReleaseDto): Promise<Release> {
    // Check for duplicate
    const existing = await this.prisma.release.findFirst({
      where: {
        projectId: data.projectId,
        version: data.version,
        environment: data.environment || 'production',
      },
    });

    if (existing) {
      throw new ConflictException('Release already exists for this version and environment');
    }

    const release = await this.prisma.release.create({
      data: {
        projectId: data.projectId,
        version: data.version,
        environment: data.environment || 'production',
        commitHash: data.commitHash,
        commitUrl: data.commitUrl,
        deployedAt: data.deployedAt || new Date(),
      },
    });

    this.logger.info('Release created', {
      releaseId: release.id,
      version: release.version,
    });

    return release;
  }

  async findById(id: string): Promise<Release | null> {
    return this.prisma.release.findUnique({
      where: { id },
      include: {
        sourceMaps: true,
        _count: {
          select: { events: true },
        },
      },
    });
  }

  async findByVersion(
    projectId: string,
    version: string,
    environment = 'production'
  ): Promise<Release | null> {
    return this.prisma.release.findFirst({
      where: {
        projectId,
        version,
        environment,
      },
      include: {
        sourceMaps: true,
      },
    });
  }

  async findByProject(
    projectId: string,
    params: { skip?: number; take?: number }
  ): Promise<{ data: Release[]; total: number }> {
    const { skip = 0, take = 20 } = params;

    const [releases, total] = await Promise.all([
      this.prisma.release.findMany({
        where: { projectId },
        skip,
        take,
        orderBy: { deployedAt: 'desc' },
        include: {
          _count: {
            select: { events: true, sourceMaps: true },
          },
        },
      }),
      this.prisma.release.count({ where: { projectId } }),
    ]);

    return { data: releases, total };
  }

  async delete(id: string): Promise<void> {
    await this.prisma.release.delete({ where: { id } });
    this.logger.info('Release deleted', { releaseId: id });
  }

  async getStats(id: string): Promise<{
    eventCount: number;
    issueCount: number;
    newIssues: number;
  }> {
    const release = await this.prisma.release.findUnique({
      where: { id },
    });

    if (!release) {
      throw new NotFoundException('Release not found');
    }

    const [eventCount, issues] = await Promise.all([
      this.prisma.event.count({ where: { releaseId: id } }),
      this.prisma.event.findMany({
        where: { releaseId: id },
        select: { issueId: true },
        distinct: ['issueId'],
      }),
    ]);

    // Count new issues (first seen in this release)
    const newIssues = await this.prisma.issue.count({
      where: {
        id: { in: issues.map((e) => e.issueId) },
        firstSeen: { gte: release.deployedAt },
      },
    });

    return {
      eventCount,
      issueCount: issues.length,
      newIssues,
    };
  }
}
