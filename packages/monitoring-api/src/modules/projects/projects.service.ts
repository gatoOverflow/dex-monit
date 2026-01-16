import { Injectable, NotFoundException, ConflictException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import type { Project, Prisma } from '@prisma/client';

export interface CreateProjectDto {
  name: string;
  slug: string;
  platform?: string;
  description?: string;
  teamId: string;
}

export interface UpdateProjectDto {
  name?: string;
  description?: string;
  platform?: string;
  settings?: Record<string, unknown>;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async create(data: CreateProjectDto): Promise<Project> {
    // Check for duplicate slug within team
    const existing = await this.prisma.project.findUnique({
      where: {
        teamId_slug: {
          teamId: data.teamId,
          slug: data.slug,
        },
      },
    });

    if (existing) {
      throw new ConflictException('Project with this slug already exists in the team');
    }

    const project = await this.prisma.project.create({
      data: {
        name: data.name,
        slug: data.slug,
        platform: data.platform || 'node',
        description: data.description,
        teamId: data.teamId,
      },
    });

    this.logger.info('Project created', { projectId: project.id, name: project.name });

    return project;
  }

  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({
      where: { id },
      include: {
        team: true,
        _count: {
          select: {
            issues: true,
            events: true,
          },
        },
      },
    });
  }

  async findByIdOrThrow(id: string): Promise<Project> {
    const project = await this.findById(id);
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  async findByTeam(teamId: string): Promise<Project[]> {
    return this.prisma.project.findMany({
      where: { teamId },
      include: {
        _count: {
          select: {
            issues: { where: { status: 'UNRESOLVED' } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async update(id: string, data: UpdateProjectDto): Promise<Project> {
    const project = await this.prisma.project.update({
      where: { id },
      data,
    });

    this.logger.info('Project updated', { projectId: id });

    return project;
  }

  async archive(id: string): Promise<Project> {
    const project = await this.prisma.project.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    this.logger.info('Project archived', { projectId: id });

    return project;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.project.delete({ where: { id } });
    this.logger.info('Project deleted', { projectId: id });
  }

  async list(params: {
    skip?: number;
    take?: number;
    where?: Prisma.ProjectWhereInput;
    orderBy?: Prisma.ProjectOrderByWithRelationInput;
  }): Promise<{ data: Project[]; total: number }> {
    const { skip = 0, take = 20, where, orderBy } = params;

    const [projects, total] = await Promise.all([
      this.prisma.project.findMany({
        skip,
        take,
        where,
        orderBy: orderBy || { createdAt: 'desc' },
        include: {
          team: true,
          _count: {
            select: {
              issues: { where: { status: 'UNRESOLVED' } },
            },
          },
        },
      }),
      this.prisma.project.count({ where }),
    ]);

    return { data: projects, total };
  }

  async getStats(id: string): Promise<{
    totalIssues: number;
    unresolvedIssues: number;
    totalEvents: number;
    eventsLast24h: number;
    eventsLast7d: number;
  }> {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalIssues, unresolvedIssues, totalEvents, eventsLast24h, eventsLast7d] =
      await Promise.all([
        this.prisma.issue.count({ where: { projectId: id } }),
        this.prisma.issue.count({ where: { projectId: id, status: 'UNRESOLVED' } }),
        this.prisma.event.count({ where: { projectId: id } }),
        this.prisma.event.count({
          where: { projectId: id, timestamp: { gte: last24h } },
        }),
        this.prisma.event.count({
          where: { projectId: id, timestamp: { gte: last7d } },
        }),
      ]);

    return {
      totalIssues,
      unresolvedIssues,
      totalEvents,
      eventsLast24h,
      eventsLast7d,
    };
  }
}
