import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Logger } from '@dex-monit/observability-logger';

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
  first_seen: string;
  last_seen: string;
  event_count: number;
  user_count: number;
  environments: string[];
  releases: string[];
  sample_event_id: string;
  sample_stacktrace: string;
}

export interface ListIssuesParams {
  projectId?: string; // Optional - if not provided, returns all issues
  status?: string;
  level?: string;
  environment?: string;
  search?: string;
  from?: Date;
  to?: Date;
  skip?: number;
  take?: number;
  sortBy?: 'last_seen' | 'first_seen' | 'event_count' | 'user_count';
  sortOrder?: 'asc' | 'desc';
}

export interface IssueStats {
  total: number;
  unresolved: number;
  resolved: number;
  ignored: number;
  byLevel: Record<string, number>;
  byEnvironment: Record<string, number>;
  newToday: number;
  newThisWeek: number;
}

@Injectable()
export class IssuesClickHouseService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly redis: RedisService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * List issues with filtering
   */
  async list(
    params: ListIssuesParams,
  ): Promise<{ data: ClickHouseIssue[]; total: number }> {
    const {
      projectId,
      status,
      level,
      environment,
      search,
      from,
      to,
      skip = 0,
      take = 25,
      sortBy = 'last_seen',
      sortOrder = 'desc',
    } = params;

    const conditions: string[] = [];
    const queryParams: Record<string, unknown> = { skip, take };

    // projectId is optional - if provided, filter by it
    if (projectId) {
      conditions.push('project_id = {projectId:String}');
      queryParams.projectId = projectId;
    }

    if (status) {
      conditions.push('status = {status:String}');
      queryParams.status = status.toUpperCase();
    }

    if (level) {
      conditions.push('level = {level:String}');
      queryParams.level = level.toUpperCase();
    }

    if (environment) {
      conditions.push('has(environments, {environment:String})');
      queryParams.environment = environment;
    }

    if (search) {
      conditions.push(
        '(title ILIKE {search:String} OR culprit ILIKE {search:String})',
      );
      queryParams.search = `%${search}%`;
    }

    if (from) {
      conditions.push('last_seen >= {from:DateTime64(3)}');
      queryParams.from = from.toISOString();
    }

    if (to) {
      conditions.push('last_seen <= {to:DateTime64(3)}');
      queryParams.to = to.toISOString();
    }

    const whereClause =
      conditions.length > 0 ? conditions.join(' AND ') : '1=1';
    const orderColumn =
      sortBy === 'event_count'
        ? 'event_count'
        : sortBy === 'user_count'
          ? 'user_count'
          : sortBy === 'first_seen'
            ? 'first_seen'
            : 'last_seen';
    const orderDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const cacheKey = `issues:list:${projectId || 'all'}:${JSON.stringify(params)}`;
    const cached = await this.redis.get<{
      data: ClickHouseIssue[];
      total: number;
    }>(cacheKey);
    if (cached) return cached;

    const [issues, totalResult] = await Promise.all([
      this.clickhouse.query<ClickHouseIssue>(
        `SELECT * FROM dex_monitoring.issues FINAL
         WHERE ${whereClause}
         ORDER BY ${orderColumn} ${orderDir}
         LIMIT {take:UInt32} OFFSET {skip:UInt32}`,
        queryParams,
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.issues FINAL
         WHERE ${whereClause}`,
        queryParams,
      ),
    ]);

    const result = { data: issues, total: totalResult[0]?.count || 0 };
    await this.redis.set(cacheKey, result, 30);

    return result;
  }

  /**
   * Get an issue by ID
   */
  async findById(id: string): Promise<ClickHouseIssue | null> {
    const issues = await this.clickhouse.query<ClickHouseIssue>(
      `SELECT * FROM dex_monitoring.issues FINAL WHERE id = {id:String} LIMIT 1`,
      { id },
    );
    return issues[0] || null;
  }

  /**
   * Get an issue by ID or throw
   */
  async findByIdOrThrow(id: string): Promise<ClickHouseIssue> {
    const issue = await this.findById(id);
    if (!issue) {
      throw new NotFoundException('Issue not found');
    }
    return issue;
  }

  /**
   * Get an issue by short ID
   */
  async findByShortId(
    projectId: string,
    shortId: string,
  ): Promise<ClickHouseIssue | null> {
    const issues = await this.clickhouse.query<ClickHouseIssue>(
      `SELECT * FROM dex_monitoring.issues FINAL 
       WHERE project_id = {projectId:String} AND short_id = {shortId:String} 
       LIMIT 1`,
      { projectId, shortId },
    );
    return issues[0] || null;
  }

  /**
   * Update issue status
   */
  async updateStatus(
    id: string,
    status: 'UNRESOLVED' | 'RESOLVED' | 'IGNORED',
  ): Promise<ClickHouseIssue> {
    const issue = await this.findByIdOrThrow(id);

    // Insert updated issue (ReplacingMergeTree will keep latest)
    await this.clickhouse.insert('issues', [
      {
        ...issue,
        status,
        updated_at: new Date().toISOString(),
      },
    ]);

    // Invalidate cache
    await this.redis.delPattern(`issues:*${issue.project_id}*`);

    this.logger.info('Issue status updated', { issueId: id, status });

    return { ...issue, status };
  }

  /**
   * Get issue statistics
   */
  async getStats(projectId: string): Promise<IssueStats> {
    const cacheKey = `issues:stats:${projectId}`;
    const cached = await this.redis.get<IssueStats>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
    );
    const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalResult,
      byStatusResult,
      byLevelResult,
      byEnvResult,
      newTodayResult,
      newWeekResult,
    ] = await Promise.all([
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.issues FINAL 
         WHERE project_id = {projectId:String}`,
        { projectId },
      ),
      this.clickhouse.query<{ status: string; count: number }>(
        `SELECT status, count() as count FROM dex_monitoring.issues FINAL 
         WHERE project_id = {projectId:String} GROUP BY status`,
        { projectId },
      ),
      this.clickhouse.query<{ level: string; count: number }>(
        `SELECT level, count() as count FROM dex_monitoring.issues FINAL 
         WHERE project_id = {projectId:String} GROUP BY level`,
        { projectId },
      ),
      this.clickhouse.query<{ env: string; count: number }>(
        `SELECT arrayJoin(environments) as env, count() as count 
         FROM dex_monitoring.issues FINAL 
         WHERE project_id = {projectId:String} 
         GROUP BY env`,
        { projectId },
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.issues FINAL 
         WHERE project_id = {projectId:String} 
         AND first_seen >= {today:DateTime64(3)}`,
        { projectId, today: todayStart.toISOString() },
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.issues FINAL 
         WHERE project_id = {projectId:String} 
         AND first_seen >= {weekStart:DateTime64(3)}`,
        { projectId, weekStart: weekStart.toISOString() },
      ),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of byStatusResult) {
      byStatus[row.status] = row.count;
    }

    const byLevel: Record<string, number> = {};
    for (const row of byLevelResult) {
      byLevel[row.level] = row.count;
    }

    const byEnvironment: Record<string, number> = {};
    for (const row of byEnvResult) {
      byEnvironment[row.env] = row.count;
    }

    const stats: IssueStats = {
      total: totalResult[0]?.count || 0,
      unresolved: byStatus['UNRESOLVED'] || 0,
      resolved: byStatus['RESOLVED'] || 0,
      ignored: byStatus['IGNORED'] || 0,
      byLevel,
      byEnvironment,
      newToday: newTodayResult[0]?.count || 0,
      newThisWeek: newWeekResult[0]?.count || 0,
    };

    await this.redis.set(cacheKey, stats, 60);

    return stats;
  }

  /**
   * Delete an issue (for cleanup)
   */
  async delete(id: string): Promise<void> {
    const issue = await this.findByIdOrThrow(id);

    // Mark as deleted (or use ALTER TABLE DELETE for actual deletion)
    await this.clickhouse.command(`
      ALTER TABLE dex_monitoring.issues 
      DELETE WHERE id = '${id}'
    `);

    // Delete associated events
    await this.clickhouse.command(`
      ALTER TABLE dex_monitoring.events 
      DELETE WHERE issue_id = '${id}'
    `);

    // Invalidate cache
    await this.redis.delPattern(`issues:*${issue.project_id}*`);

    this.logger.info('Issue deleted', { issueId: id });
  }

  /**
   * Merge issues (combine duplicates)
   */
  async merge(targetId: string, sourceIds: string[]): Promise<ClickHouseIssue> {
    const target = await this.findByIdOrThrow(targetId);

    // Update events to point to target issue
    for (const sourceId of sourceIds) {
      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.events 
        UPDATE issue_id = '${targetId}'
        WHERE issue_id = '${sourceId}'
      `);
    }

    // Delete source issues
    for (const sourceId of sourceIds) {
      await this.clickhouse.command(`
        ALTER TABLE dex_monitoring.issues 
        DELETE WHERE id = '${sourceId}'
      `);
    }

    // Invalidate cache
    await this.redis.delPattern(`issues:*${target.project_id}*`);

    this.logger.info('Issues merged', { targetId, sourceIds });

    return target;
  }
}
