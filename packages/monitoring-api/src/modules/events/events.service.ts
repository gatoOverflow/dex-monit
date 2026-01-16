import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import { IssueGroupingService } from './issue-grouping.service.js';
import type { ErrorEvent } from '@dex-monit/observability-contracts';
import type { Event, Issue, Prisma } from '@prisma/client';

export interface IngestResult {
  eventId: string;
  issueId: string;
  isNewIssue: boolean;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groupingService: IssueGroupingService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  /**
   * Ingest an error event
   * 
   * 1. Generate fingerprint
   * 2. Find or create issue
   * 3. Store event
   * 4. Update issue statistics
   */
  async ingest(event: ErrorEvent, projectId: string): Promise<IngestResult> {
    // Generate fingerprint
    const { fingerprint, fingerprintHash, culprit, metadata } =
      this.groupingService.generateFingerprint(event);

    // Check for release
    let releaseId: string | null = null;
    if (event.release) {
      const release = await this.prisma.release.findFirst({
        where: {
          projectId,
          version: event.release,
          environment: event.environment,
        },
      });
      releaseId = release?.id || null;
    }

    // Find or create issue
    const { issue, isNew } = await this.findOrCreateIssue({
      projectId,
      fingerprint,
      fingerprintHash,
      title: event.message,
      culprit,
      level: this.mapSeverity(event.level),
      platform: event.platform,
      metadata,
    });

    // Create event
    const storedEvent = await this.prisma.event.create({
      data: {
        eventId: event.eventId,
        projectId,
        issueId: issue.id,
        releaseId,
        message: event.message,
        level: this.mapSeverity(event.level),
        platform: event.platform,
        environment: event.environment,
        serverName: event.serverName,
        exceptionType: event.exception?.type,
        exceptionValue: event.exception?.value,
        stacktrace: event.exception?.stacktrace as Prisma.JsonValue,
        contexts: event.contexts as Prisma.JsonValue,
        tags: event.contexts?.tags as Prisma.JsonValue ?? {},
        extra: event.contexts?.extra as Prisma.JsonValue ?? {},
        breadcrumbs: event.breadcrumbs as Prisma.JsonValue ?? [],
        requestUrl: event.contexts?.request?.url,
        requestMethod: event.contexts?.request?.method,
        requestData: event.contexts?.request as Prisma.JsonValue,
        userId: event.contexts?.user?.id,
        userEmail: event.contexts?.user?.email,
        userIp: event.contexts?.user?.ipAddress,
        requestId: event.requestId,
        transactionId: event.transactionId,
        sdkName: event.sdk?.name || 'unknown',
        sdkVersion: event.sdk?.version || 'unknown',
        timestamp: new Date(event.timestamp),
      },
    });

    // Update issue statistics
    await this.updateIssueStats(issue.id);

    this.logger.info('Event ingested', {
      eventId: event.eventId,
      issueId: issue.id,
      isNewIssue: isNew,
    });

    return {
      eventId: storedEvent.eventId,
      issueId: issue.id,
      isNewIssue: isNew,
    };
  }

  /**
   * Find or create an issue based on fingerprint
   */
  private async findOrCreateIssue(params: {
    projectId: string;
    fingerprint: string[];
    fingerprintHash: string;
    title: string;
    culprit: string | null;
    level: Event['level'];
    platform: string;
    metadata: Record<string, unknown>;
  }): Promise<{ issue: Issue; isNew: boolean }> {
    const { projectId, fingerprint, fingerprintHash, title, culprit, level, platform, metadata } = params;

    // Try to find existing issue
    const existingIssue = await this.prisma.issue.findUnique({
      where: {
        projectId_fingerprintHash: {
          projectId,
          fingerprintHash,
        },
      },
    });

    if (existingIssue) {
      // Update last seen and potentially reopen if resolved
      const updates: Prisma.IssueUpdateInput = {
        lastSeen: new Date(),
      };

      // Check for regression (resolved issue reappearing)
      if (existingIssue.status === 'RESOLVED') {
        updates.status = 'UNRESOLVED';
        updates.resolvedAt = null;
        
        // TODO: Trigger regression alert
        this.logger.warn('Issue regressed', { issueId: existingIssue.id });
      }

      const issue = await this.prisma.issue.update({
        where: { id: existingIssue.id },
        data: updates,
      });

      return { issue, isNew: false };
    }

    // Create new issue
    const issueCount = await this.prisma.issue.count({ where: { projectId } });
    const shortId = this.groupingService.generateShortId(issueCount + 1);

    const issue = await this.prisma.issue.create({
      data: {
        shortId,
        projectId,
        title,
        culprit,
        level,
        platform,
        fingerprint,
        fingerprintHash,
        metadata: metadata as Prisma.JsonValue,
      },
    });

    this.logger.info('New issue created', { issueId: issue.id, shortId });

    return { issue, isNew: true };
  }

  /**
   * Update issue statistics (event count, user count)
   */
  private async updateIssueStats(issueId: string): Promise<void> {
    // Count events
    const eventCount = await this.prisma.event.count({
      where: { issueId },
    });

    // Count unique users
    const userCount = await this.prisma.event.groupBy({
      by: ['userId'],
      where: {
        issueId,
        userId: { not: null },
      },
    });

    await this.prisma.issue.update({
      where: { id: issueId },
      data: {
        eventCount,
        userCount: userCount.length,
      },
    });
  }

  /**
   * Map severity string to enum
   */
  private mapSeverity(level: string): Event['level'] {
    const map: Record<string, Event['level']> = {
      debug: 'DEBUG',
      info: 'INFO',
      warning: 'WARNING',
      error: 'ERROR',
      fatal: 'FATAL',
    };
    return map[level] || 'ERROR';
  }

  /**
   * Get events for an issue
   */
  async findByIssue(
    issueId: string,
    params: { skip?: number; take?: number }
  ): Promise<{ data: Event[]; total: number }> {
    const { skip = 0, take = 20 } = params;

    const [events, total] = await Promise.all([
      this.prisma.event.findMany({
        where: { issueId },
        skip,
        take,
        orderBy: { timestamp: 'desc' },
      }),
      this.prisma.event.count({ where: { issueId } }),
    ]);

    return { data: events, total };
  }

  /**
   * Get a single event by ID
   */
  async findById(eventId: string): Promise<Event | null> {
    return this.prisma.event.findUnique({
      where: { eventId },
      include: {
        issue: true,
        project: true,
      },
    });
  }

  /**
   * Get latest event for an issue
   */
  async findLatestForIssue(issueId: string): Promise<Event | null> {
    return this.prisma.event.findFirst({
      where: { issueId },
      orderBy: { timestamp: 'desc' },
    });
  }
}
