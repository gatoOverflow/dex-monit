import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import type { Issue, IssueStatus, Severity, Prisma } from '@prisma/client';

export interface UpdateIssueDto {
  status?: IssueStatus;
  assignedToId?: string | null;
  isIgnored?: boolean;
  ignoreUntil?: Date | null;
  ignoreReason?: string | null;
}

export interface ListIssuesParams {
  projectId?: string;
  status?: IssueStatus;
  level?: Severity;
  assignedToId?: string;
  isIgnored?: boolean;
  search?: string;
  skip?: number;
  take?: number;
  sortBy?: 'lastSeen' | 'firstSeen' | 'eventCount' | 'userCount';
  sortOrder?: 'asc' | 'desc';
}

export type IssueWithDetails = Issue & {
  project: { id: string; name: string; slug: string };
  assignedTo?: { id: string; name: string; email: string } | null;
  _count: { events: number };
  events?: Array<{
    id: string;
    eventId: string;
    timestamp: Date;
    level: Severity;
    message: string | null;
    environment: string;
    release: string | null;
    serverName: string | null;
    stacktrace: unknown;
    breadcrumbs: unknown;
    contexts: unknown;
    tags: unknown;
    requestUrl: string | null;
    requestMethod: string | null;
    requestData: unknown;
    requestId: string | null;
  }>;
};

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async findById(id: string): Promise<IssueWithDetails | null> {
    return this.prisma.issue.findUnique({
      where: { id },
      include: {
        project: {
          select: { id: true, name: true, slug: true },
        },
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { events: true },
        },
        events: {
          orderBy: { timestamp: 'desc' },
          take: 20,
          select: {
            id: true,
            eventId: true,
            timestamp: true,
            level: true,
            message: true,
            environment: true,
            release: true,
            serverName: true,
            stacktrace: true,
            breadcrumbs: true,
            contexts: true,
            tags: true,
            requestUrl: true,
            requestMethod: true,
            requestData: true,
            requestId: true,
          },
        },
      },
    });
  }

  async findByShortId(shortId: string): Promise<IssueWithDetails | null> {
    return this.prisma.issue.findUnique({
      where: { shortId },
      include: {
        project: {
          select: { id: true, name: true, slug: true },
        },
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { events: true },
        },
        events: {
          orderBy: { timestamp: 'desc' },
          take: 20,
          select: {
            id: true,
            eventId: true,
            timestamp: true,
            level: true,
            message: true,
            environment: true,
            release: true,
            serverName: true,
            stacktrace: true,
            breadcrumbs: true,
            contexts: true,
            tags: true,
            requestUrl: true,
            requestMethod: true,
            requestData: true,
            requestId: true,
          },
        },
      },
    });
  }

  async findByIdOrThrow(id: string): Promise<IssueWithDetails> {
    const issue = await this.findById(id);
    if (!issue) {
      throw new NotFoundException('Issue not found');
    }
    return issue;
  }

  async list(params: ListIssuesParams): Promise<{ data: IssueWithDetails[]; total: number }> {
    const {
      projectId,
      status,
      level,
      assignedToId,
      isIgnored,
      search,
      skip = 0,
      take = 20,
      sortBy = 'lastSeen',
      sortOrder = 'desc',
    } = params;

    const where: Prisma.IssueWhereInput = {
      ...(projectId && { projectId }),
      ...(status && { status }),
      ...(level && { level }),
      ...(assignedToId && { assignedToId }),
      ...(isIgnored !== undefined && { isIgnored }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { shortId: { contains: search, mode: 'insensitive' } },
          { culprit: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const orderBy: Prisma.IssueOrderByWithRelationInput = {
      [sortBy]: sortOrder,
    };

    const [issues, total] = await Promise.all([
      this.prisma.issue.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          project: {
            select: { id: true, name: true, slug: true },
          },
          assignedTo: {
            select: { id: true, name: true, email: true },
          },
          _count: {
            select: { events: true },
          },
        },
      }),
      this.prisma.issue.count({ where }),
    ]);

    return { data: issues, total };
  }

  async update(id: string, data: UpdateIssueDto, userId?: string): Promise<Issue> {
    const issue = await this.prisma.issue.update({
      where: { id },
      data: {
        status: data.status,
        assignedToId: data.assignedToId,
        isIgnored: data.isIgnored,
        ignoreUntil: data.ignoreUntil,
        ignoreReason: data.ignoreReason,
        ...(data.status === 'RESOLVED' && { resolvedAt: new Date() }),
      },
    });

    // Log activity
    if (data.status) {
      await this.createActivity(id, userId, this.getActivityType(data.status), {
        newStatus: data.status,
      });
    }

    if (data.assignedToId !== undefined) {
      await this.createActivity(
        id,
        userId,
        data.assignedToId ? 'ISSUE_ASSIGNED' : 'ISSUE_UNASSIGNED',
        { assignedToId: data.assignedToId }
      );
    }

    this.logger.info('Issue updated', { issueId: id, updates: data });

    return issue;
  }

  async resolve(id: string, userId?: string): Promise<Issue> {
    return this.update(id, { status: 'RESOLVED' }, userId);
  }

  async unresolve(id: string, userId?: string): Promise<Issue> {
    return this.update(id, { status: 'UNRESOLVED' }, userId);
  }

  async ignore(id: string, reason?: string, until?: Date, userId?: string): Promise<Issue> {
    const issue = await this.prisma.issue.update({
      where: { id },
      data: {
        status: 'IGNORED',
        isIgnored: true,
        ignoreReason: reason,
        ignoreUntil: until,
      },
    });

    await this.createActivity(id, userId, 'ISSUE_IGNORED', { reason, until });

    return issue;
  }

  async unignore(id: string, userId?: string): Promise<Issue> {
    const issue = await this.prisma.issue.update({
      where: { id },
      data: {
        status: 'UNRESOLVED',
        isIgnored: false,
        ignoreReason: null,
        ignoreUntil: null,
      },
    });

    await this.createActivity(id, userId, 'ISSUE_UNIGNORED', {});

    return issue;
  }

  async assign(id: string, assignedToId: string | null, userId?: string): Promise<Issue> {
    return this.update(id, { assignedToId }, userId);
  }

  async merge(targetId: string, sourceIds: string[], userId?: string): Promise<Issue> {
    // Update all events from source issues to point to target
    await this.prisma.event.updateMany({
      where: { issueId: { in: sourceIds } },
      data: { issueId: targetId },
    });

    // Update statistics
    const [eventCount, userCount] = await Promise.all([
      this.prisma.event.count({ where: { issueId: targetId } }),
      this.prisma.event.groupBy({
        by: ['userId'],
        where: { issueId: targetId, userId: { not: null } },
      }),
    ]);

    const target = await this.prisma.issue.update({
      where: { id: targetId },
      data: {
        eventCount,
        userCount: userCount.length,
      },
    });

    // Delete source issues
    await this.prisma.issue.deleteMany({
      where: { id: { in: sourceIds } },
    });

    await this.createActivity(targetId, userId, 'ISSUE_MERGED', {
      mergedIds: sourceIds,
    });

    this.logger.info('Issues merged', { targetId, sourceIds });

    return target;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.issue.delete({ where: { id } });
    this.logger.info('Issue deleted', { issueId: id });
  }

  async getActivity(id: string, limit = 50) {
    return this.prisma.activity.findMany({
      where: { issueId: id },
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async addComment(id: string, authorId: string, content: string) {
    const comment = await this.prisma.issueComment.create({
      data: {
        issueId: id,
        authorId,
        content,
      },
    });

    await this.createActivity(id, authorId, 'COMMENT_ADDED', {
      commentId: comment.id,
    });

    return comment;
  }

  async getComments(id: string) {
    return this.prisma.issueComment.findMany({
      where: { issueId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        author: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
    });
  }

  private async createActivity(
    issueId: string,
    userId: string | undefined,
    type: string,
    data: Record<string, unknown>
  ) {
    await this.prisma.activity.create({
      data: {
        issueId,
        userId,
        type: type as Prisma.ActivityCreateInput['type'],
        data: data as Prisma.JsonValue,
      },
    });
  }

  /**
   * Track activity from ClickHouse-based operations
   */
  async trackActivity(
    issueId: string,
    userId: string,
    status: string,
    data: Record<string, unknown>
  ): Promise<void> {
    const activityType = this.getActivityType(status as IssueStatus);
    await this.createActivity(issueId, userId, activityType, data);
  }

  private getActivityType(status: IssueStatus): string {
    switch (status) {
      case 'RESOLVED':
        return 'ISSUE_RESOLVED';
      case 'UNRESOLVED':
        return 'ISSUE_REOPENED';
      case 'IGNORED':
        return 'ISSUE_IGNORED';
      default:
        return 'STATUS_CHANGED';
    }
  }
}
