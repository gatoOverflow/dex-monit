import { Injectable, Inject } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Logger } from '@dex-monit/observability-logger';
import { IssueGroupingService } from './issue-grouping.service.js';
import type { ErrorEvent } from '@dex-monit/observability-contracts';
import { randomUUID } from 'crypto';

export interface IngestResult {
  eventId: string;
  issueId: string;
  isNewIssue: boolean;
}

export interface ClickHouseEvent {
  id: string;
  project_id: string;
  event_id: string;
  timestamp: string;
  type: string;
  value: string;
  level: string;
  fingerprint: string;
  environment: string;
  release: string;
  server_name: string;
  transaction: string;
  user_id: string;
  user_email: string;
  user_ip: string;
  request_url: string;
  request_method: string;
  exception: string;
  stacktrace: string;
  breadcrumbs: string;
  tags: string;
  extra: string;
  contexts: string;
  sdk_name: string;
  sdk_version: string;
  issue_id: string;
}

export interface ClickHouseIssue {
  id: string;
  project_id: string;
  short_id: string;
  fingerprint: string;
  title: string;
  culprit: string;
  type: string;
  level: string;
  status: string;
  platform: string;
  first_seen: string;
  last_seen: string;
  event_count: number;
  user_count: number;
  environments: string[];
  releases: string[];
  sample_event_id: string;
  sample_stacktrace: string;
}

@Injectable()
export class EventsClickHouseService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly redis: RedisService,
    private readonly groupingService: IssueGroupingService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Ingest an error event to ClickHouse
   */
  async ingest(event: ErrorEvent, projectId: string): Promise<IngestResult> {
    const { fingerprint, fingerprintHash, culprit, metadata } =
      this.groupingService.generateFingerprint(event);

    // Find or create issue
    const { issue, isNew } = await this.findOrCreateIssue({
      projectId,
      fingerprint: fingerprintHash,
      title: event.message,
      culprit,
      type: event.exception?.type || 'Error',
      level: event.level,
      platform: event.platform || 'node',
      environment: event.environment,
      release: event.release,
      stacktrace: event.exception?.stacktrace,
      eventId: event.eventId,
    });

    // Insert event into ClickHouse
    const eventData: Record<string, unknown> = {
      project_id: projectId,
      event_id: event.eventId,
      timestamp: new Date(event.timestamp).toISOString(),
      type: event.exception?.type || 'Error',
      value: event.exception?.value || event.message,
      level: event.level.toUpperCase(),
      fingerprint: fingerprintHash,
      environment: event.environment || '',
      release: event.release || '',
      server_name: event.serverName || '',
      transaction: event.transaction || '',
      user_id: event.contexts?.user?.id || '',
      user_email: event.contexts?.user?.email || '',
      user_ip: event.contexts?.user?.ipAddress || '',
      request_url: event.contexts?.request?.url || '',
      request_method: event.contexts?.request?.method || '',
      exception: JSON.stringify(event.exception || {}),
      stacktrace: JSON.stringify(event.exception?.stacktrace || []),
      breadcrumbs: JSON.stringify(event.breadcrumbs || []),
      tags: JSON.stringify(event.contexts?.tags || {}),
      extra: JSON.stringify(event.contexts?.extra || {}),
      contexts: JSON.stringify(event.contexts || {}),
      sdk_name: event.sdk?.name || 'unknown',
      sdk_version: event.sdk?.version || 'unknown',
      issue_id: issue.id,
    };

    await this.clickhouse.insert('events', [eventData]);

    // Invalidate cache
    await this.redis.delPattern(`events:${projectId}:*`);
    await this.redis.delPattern(`issues:${projectId}:*`);

    this.logger.info('Event ingested to ClickHouse', {
      eventId: event.eventId,
      issueId: issue.id,
      isNewIssue: isNew,
    });

    return {
      eventId: event.eventId,
      issueId: issue.id,
      isNewIssue: isNew,
    };
  }

  /**
   * Find or create an issue
   */
  private async findOrCreateIssue(params: {
    projectId: string;
    fingerprint: string;
    title: string;
    culprit: string | null;
    type: string;
    level: string;
    platform?: string;
    environment?: string;
    release?: string;
    stacktrace?: unknown[];
    eventId: string;
  }): Promise<{ issue: ClickHouseIssue; isNew: boolean }> {
    const { projectId, fingerprint, title, culprit, type, level, platform, environment, release, stacktrace, eventId } = params;

    // Check if issue exists
    const existing = await this.clickhouse.query<ClickHouseIssue>(
      `SELECT * FROM dex_monitoring.issues 
       WHERE project_id = {projectId:String} AND fingerprint = {fingerprint:String}
       LIMIT 1`,
      { projectId, fingerprint },
    );

    const now = new Date().toISOString();

    if (existing.length > 0) {
      const issue = existing[0];
      
      // Update issue with new data
      const environments = issue.environments || [];
      if (environment && !environments.includes(environment)) {
        environments.push(environment);
      }

      const releases = issue.releases || [];
      if (release && !releases.includes(release)) {
        releases.push(release);
      }

      // Check for regression
      let status = issue.status;
      if (issue.status === 'RESOLVED') {
        status = 'UNRESOLVED';
        this.logger.warn('Issue regressed', { issueId: issue.id });
      }

      // Insert updated issue (ReplacingMergeTree will keep latest)
      await this.clickhouse.insert('issues', [{
        ...issue,
        last_seen: now,
        event_count: issue.event_count + 1,
        status,
        environments,
        releases,
      }]);

      // Update user count asynchronously
      this.updateUserCount(projectId, fingerprint);

      return { issue: { ...issue, last_seen: now }, isNew: false };
    }

    // Create new issue
    const issueId = randomUUID();
    const shortId = await this.generateShortId(projectId);

    const newIssue: ClickHouseIssue = {
      id: issueId,
      project_id: projectId,
      short_id: shortId,
      fingerprint,
      title: title.substring(0, 500),
      culprit: culprit || '',
      type,
      level: level.toUpperCase(),
      status: 'UNRESOLVED',
      platform: platform || 'node',
      first_seen: now,
      last_seen: now,
      event_count: 1,
      user_count: 1,
      environments: environment ? [environment] : [],
      releases: release ? [release] : [],
      sample_event_id: eventId,
      sample_stacktrace: JSON.stringify(stacktrace || []),
    };

    await this.clickhouse.insert('issues', [newIssue]);

    this.logger.info('New issue created', { issueId, shortId });

    return { issue: newIssue, isNew: true };
  }

  /**
   * Generate a short ID for new issues
   */
  private async generateShortId(projectId: string): Promise<string> {
    // Use Redis counter for thread-safe increments
    const count = await this.redis.incr(`issue_counter:${projectId}`);
    return this.groupingService.generateShortId(count);
  }

  /**
   * Update user count asynchronously
   */
  private async updateUserCount(projectId: string, fingerprint: string): Promise<void> {
    try {
      const result = await this.clickhouse.query<{ count: number }>(
        `SELECT uniqExact(user_id) as count 
         FROM dex_monitoring.events 
         WHERE project_id = {projectId:String} 
         AND fingerprint = {fingerprint:String}
         AND user_id != ''`,
        { projectId, fingerprint },
      );

      if (result.length > 0) {
        await this.clickhouse.command(`
          ALTER TABLE dex_monitoring.issues 
          UPDATE user_count = ${result[0].count}
          WHERE project_id = '${projectId}' AND fingerprint = '${fingerprint}'
        `);
      }
    } catch (error) {
      this.logger.warn('Failed to update user count', { error });
    }
  }

  /**
   * Get events for an issue
   */
  async findByIssue(
    issueId: string,
    params: { skip?: number; take?: number },
  ): Promise<{ data: ClickHouseEvent[]; total: number }> {
    const { skip = 0, take = 20 } = params;

    const cacheKey = `events:issue:${issueId}:${skip}:${take}`;
    const cached = await this.redis.get<{ data: ClickHouseEvent[]; total: number }>(cacheKey);
    if (cached) return cached;

    const [events, totalResult] = await Promise.all([
      this.clickhouse.query<ClickHouseEvent>(
        `SELECT * FROM dex_monitoring.events 
         WHERE issue_id = {issueId:String}
         ORDER BY timestamp DESC
         LIMIT {take:UInt32} OFFSET {skip:UInt32}`,
        { issueId, take, skip },
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.events 
         WHERE issue_id = {issueId:String}`,
        { issueId },
      ),
    ]);

    const result = { data: events, total: totalResult[0]?.count || 0 };
    await this.redis.set(cacheKey, result, 30);

    return result;
  }

  /**
   * Get a single event by ID
   */
  async findById(eventId: string): Promise<ClickHouseEvent | null> {
    const events = await this.clickhouse.query<ClickHouseEvent>(
      `SELECT * FROM dex_monitoring.events WHERE event_id = {eventId:String} LIMIT 1`,
      { eventId },
    );
    return events[0] || null;
  }

  /**
   * List events with filters
   */
  async list(params: {
    projectId: string;
    level?: string;
    environment?: string;
    from?: Date;
    to?: Date;
    skip?: number;
    take?: number;
  }): Promise<{ data: ClickHouseEvent[]; total: number }> {
    const { projectId, level, environment, from, to, skip = 0, take = 50 } = params;

    const conditions: string[] = ['project_id = {projectId:String}'];
    const queryParams: Record<string, unknown> = { projectId, skip, take };

    if (level) {
      conditions.push('level = {level:String}');
      queryParams.level = level.toUpperCase();
    }

    if (environment) {
      conditions.push('environment = {environment:String}');
      queryParams.environment = environment;
    }

    if (from) {
      conditions.push('timestamp >= {from:DateTime64(3)}');
      queryParams.from = from.toISOString();
    }

    if (to) {
      conditions.push('timestamp <= {to:DateTime64(3)}');
      queryParams.to = to.toISOString();
    }

    const whereClause = conditions.join(' AND ');

    const [events, totalResult] = await Promise.all([
      this.clickhouse.query<ClickHouseEvent>(
        `SELECT * FROM dex_monitoring.events 
         WHERE ${whereClause}
         ORDER BY timestamp DESC
         LIMIT {take:UInt32} OFFSET {skip:UInt32}`,
        queryParams,
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.events WHERE ${whereClause}`,
        queryParams,
      ),
    ]);

    return { data: events, total: totalResult[0]?.count || 0 };
  }

  /**
   * Get event stats for a project
   */
  async getStats(
    projectId: string,
    timeRange: { from: Date; to: Date },
  ): Promise<{
    total: number;
    byLevel: Record<string, number>;
    byHour: Array<{ hour: string; count: number }>;
  }> {
    const cacheKey = `events:stats:${projectId}:${timeRange.from.getTime()}:${timeRange.to.getTime()}`;
    const cached = await this.redis.get<{
      total: number;
      byLevel: Record<string, number>;
      byHour: Array<{ hour: string; count: number }>;
    }>(cacheKey);
    if (cached) return cached;

    const [totalResult, byLevelResult, byHourResult] = await Promise.all([
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.events 
         WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}`,
        { projectId, from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
      ),
      this.clickhouse.query<{ level: string; count: number }>(
        `SELECT level, count() as count FROM dex_monitoring.events 
         WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}
         GROUP BY level`,
        { projectId, from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
      ),
      this.clickhouse.query<{ hour: string; count: number }>(
        `SELECT toStartOfHour(timestamp) as hour, count() as count 
         FROM dex_monitoring.events 
         WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}
         GROUP BY hour
         ORDER BY hour`,
        { projectId, from: timeRange.from.toISOString(), to: timeRange.to.toISOString() },
      ),
    ]);

    const byLevel: Record<string, number> = {};
    for (const row of byLevelResult) {
      byLevel[row.level] = row.count;
    }

    const result = {
      total: totalResult[0]?.count || 0,
      byLevel,
      byHour: byHourResult,
    };

    await this.redis.set(cacheKey, result, 60);
    return result;
  }
}
