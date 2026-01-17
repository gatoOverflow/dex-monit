import { Injectable, Inject } from '@nestjs/common';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';
import { Logger } from '@dex-monit/observability-logger';
import { randomUUID } from 'crypto';

export interface ClickHouseSession {
  id: string;
  project_id: string;
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string;
  last_activity: string;
  duration_ms: number;
  is_active: number;
  platform: string;
  device_type: string;
  device_brand: string;
  device_model: string;
  os_name: string;
  os_version: string;
  app_version: string;
  browser: string;
  browser_version: string;
  ip: string;
  country: string;
  city: string;
  page_views: number;
  events_count: number;
  errors_count: number;
  entry_page: string;
  exit_page: string;
  referrer: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
}

export interface ClickHousePageView {
  id: string;
  project_id: string;
  session_id: string;
  user_id: string;
  timestamp: string;
  page_url: string;
  page_path: string;
  page_title: string;
  screen_name: string;
  load_time_ms: number;
  dom_ready_ms: number;
  time_on_page_ms: number;
  scroll_depth: number;
  interactions: number;
  referrer: string;
  previous_page: string;
  viewport_width: number;
  viewport_height: number;
}

export interface CreateSessionDto {
  sessionId: string;
  userId?: string;
  platform?: string;
  deviceType?: string;
  osName?: string;
  osVersion?: string;
  appVersion?: string;
  browser?: string;
  browserVersion?: string;
  ip?: string;
  country?: string;
  city?: string;
  entryPage?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  // Additional device info from SDK
  deviceBrand?: string;
  deviceModel?: string;
  bundleId?: string;
  buildNumber?: string;
  isEmulator?: boolean;
}

export interface CreatePageViewDto {
  sessionId: string;
  userId?: string;
  pageUrl?: string;
  pagePath?: string;
  pageTitle?: string;
  screenName?: string;
  loadTimeMs?: number;
  domReadyMs?: number;
  referrer?: string;
  previousPage?: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

export interface ActiveUsersStats {
  now: number;
  last5m: number;
  last15m: number;
  last30m: number;
  last1h: number;
  today: number;
  thisWeek: number;
  thisMonth: number;
}

export interface SessionStats {
  totalSessions: number;
  activeSessions: number;
  avgDurationMs: number;
  avgPageViews: number;
  bounceRate: number;
  byPlatform: Record<string, number>;
  byDevice: Record<string, number>;
  byCountry: Record<string, number>;
}

@Injectable()
export class SessionsClickHouseService {
  constructor(
    private readonly clickhouse: ClickHouseService,
    private readonly redis: RedisService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Start or update a session
   */
  async startSession(
    projectId: string,
    data: CreateSessionDto,
  ): Promise<string> {
    const now = new Date().toISOString();

    // Check if session already exists
    const existing = await this.clickhouse.query<ClickHouseSession>(
      `SELECT * FROM dex_monitoring.sessions 
       WHERE project_id = {projectId:String} AND session_id = {sessionId:String}
       LIMIT 1`,
      { projectId, sessionId: data.sessionId },
    );

    if (existing.length > 0) {
      // Update existing session
      await this.updateSessionActivity(
        projectId,
        data.sessionId,
        data.entryPage,
      );
      return existing[0].id;
    }

    // Create new session
    const id = randomUUID();
    await this.clickhouse.insert('sessions', [
      {
        id,
        project_id: projectId,
        session_id: data.sessionId,
        user_id: data.userId || '',
        started_at: now,
        ended_at: now,
        last_activity: now,
        duration_ms: 0,
        is_active: 1,
        platform: data.platform || 'unknown',
        device_type: data.deviceType || 'unknown',
        device_brand: data.deviceBrand || '',
        device_model: data.deviceModel || '',
        os_name: data.osName || '',
        os_version: data.osVersion || '',
        app_version: data.appVersion || '',
        browser: data.browser || '',
        browser_version: data.browserVersion || '',
        ip: data.ip || '',
        country: data.country || '',
        city: data.city || '',
        page_views: 0,
        events_count: 0,
        errors_count: 0,
        entry_page: data.entryPage || '',
        exit_page: '',
        referrer: data.referrer || '',
        utm_source: data.utmSource || '',
        utm_medium: data.utmMedium || '',
        utm_campaign: data.utmCampaign || '',
      },
    ]);

    // Track active user in Redis for real-time stats
    await this.trackActiveUser(projectId, data.userId || data.sessionId);

    this.logger.info('Session started', {
      projectId,
      sessionId: data.sessionId,
    });

    return id;
  }

  /**
   * Update session activity (heartbeat)
   */
  async updateSessionActivity(
    projectId: string,
    sessionId: string,
    currentPage?: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    const existing = await this.clickhouse.query<ClickHouseSession>(
      `SELECT * FROM dex_monitoring.sessions FINAL
       WHERE project_id = {projectId:String} AND session_id = {sessionId:String}
       LIMIT 1`,
      { projectId, sessionId },
    );

    if (existing.length === 0) return;

    const session = existing[0];
    const startedAt = new Date(session.started_at);
    const durationMs = Date.now() - startedAt.getTime();

    await this.clickhouse.insert('sessions', [
      {
        ...session,
        last_activity: now,
        duration_ms: durationMs,
        exit_page: currentPage || session.exit_page,
      },
    ]);

    // Update Redis active user tracking
    await this.trackActiveUser(projectId, session.user_id || sessionId);
  }

  /**
   * Identify/update user for a session
   */
  async identifyUser(
    projectId: string,
    sessionId: string,
    user: { userId?: string; email?: string; name?: string },
  ): Promise<void> {
    const existing = await this.clickhouse.query<ClickHouseSession>(
      `SELECT * FROM dex_monitoring.sessions FINAL
       WHERE project_id = {projectId:String} AND session_id = {sessionId:String}
       LIMIT 1`,
      { projectId, sessionId },
    );

    if (existing.length === 0) {
      this.logger.warn('Session not found for identify', {
        projectId,
        sessionId,
      });
      return;
    }

    const session = existing[0];
    const userId = user.userId || user.email || user.name || session.user_id;

    await this.clickhouse.insert('sessions', [
      {
        ...session,
        user_id: userId,
        last_activity: new Date().toISOString(),
      },
    ]);

    this.logger.info('User identified for session', {
      projectId,
      sessionId,
      userId,
    });
  }

  /**
   * End a session
   */
  async endSession(projectId: string, sessionId: string): Promise<void> {
    const now = new Date().toISOString();

    const existing = await this.clickhouse.query<ClickHouseSession>(
      `SELECT * FROM dex_monitoring.sessions FINAL
       WHERE project_id = {projectId:String} AND session_id = {sessionId:String}
       LIMIT 1`,
      { projectId, sessionId },
    );

    if (existing.length === 0) return;

    const session = existing[0];
    const startedAt = new Date(session.started_at);
    const durationMs = Date.now() - startedAt.getTime();

    await this.clickhouse.insert('sessions', [
      {
        ...session,
        ended_at: now,
        last_activity: now,
        duration_ms: durationMs,
        is_active: 0,
      },
    ]);

    this.logger.info('Session ended', { projectId, sessionId });
  }

  /**
   * Track a page view (auto-creates session if needed)
   */
  async trackPageView(
    projectId: string,
    data: CreatePageViewDto,
  ): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();

    // Auto-create session if it doesn't exist
    await this.ensureSessionExists(projectId, data.sessionId, data.userId);

    await this.clickhouse.insert('page_views', [
      {
        id,
        project_id: projectId,
        session_id: data.sessionId,
        user_id: data.userId || '',
        timestamp: now,
        page_url: data.pageUrl || '',
        page_path: data.pagePath || '',
        page_title: data.pageTitle || '',
        screen_name: data.screenName || '',
        load_time_ms: data.loadTimeMs || 0,
        dom_ready_ms: data.domReadyMs || 0,
        time_on_page_ms: 0,
        scroll_depth: 0,
        interactions: 0,
        referrer: data.referrer || '',
        previous_page: data.previousPage || '',
        viewport_width: data.viewportWidth || 0,
        viewport_height: data.viewportHeight || 0,
      },
    ]);

    // Increment page views in session
    await this.incrementSessionPageViews(projectId, data.sessionId);

    // Update session activity
    await this.updateSessionActivity(
      projectId,
      data.sessionId,
      data.pagePath || data.screenName,
    );

    return id;
  }

  /**
   * Ensure a session exists, create if not
   */
  private async ensureSessionExists(
    projectId: string,
    sessionId: string,
    userId?: string,
  ): Promise<void> {
    const existing = await this.clickhouse.query<ClickHouseSession>(
      `SELECT id FROM dex_monitoring.sessions 
       WHERE project_id = {projectId:String} AND session_id = {sessionId:String}
       LIMIT 1`,
      { projectId, sessionId },
    );

    if (existing.length > 0) return;

    // Auto-create session
    const now = new Date().toISOString();
    const id = randomUUID();

    await this.clickhouse.insert('sessions', [
      {
        id,
        project_id: projectId,
        session_id: sessionId,
        user_id: userId || '',
        started_at: now,
        ended_at: now,
        last_activity: now,
        duration_ms: 0,
        is_active: 1,
        platform: 'react-native',
        device_type: 'unknown',
        device_brand: '',
        device_model: '',
        os_name: '',
        os_version: '',
        app_version: '',
        browser: '',
        browser_version: '',
        ip: '',
        country: '',
        city: '',
        page_views: 0,
        events_count: 0,
        errors_count: 0,
        entry_page: '',
        exit_page: '',
        referrer: '',
        utm_source: '',
        utm_medium: '',
        utm_campaign: '',
      },
    ]);

    this.logger.info('Session auto-created from page view', {
      projectId,
      sessionId,
    });
  }

  /**
   * Increment page views count in session
   */
  private async incrementSessionPageViews(
    projectId: string,
    sessionId: string,
  ): Promise<void> {
    const existing = await this.clickhouse.query<ClickHouseSession>(
      `SELECT * FROM dex_monitoring.sessions FINAL
       WHERE project_id = {projectId:String} AND session_id = {sessionId:String}
       LIMIT 1`,
      { projectId, sessionId },
    );

    if (existing.length === 0) return;

    const session = existing[0];
    await this.clickhouse.insert('sessions', [
      {
        ...session,
        page_views: session.page_views + 1,
        last_activity: new Date().toISOString(),
      },
    ]);
  }

  /**
   * Track active user in Redis (for real-time stats)
   */
  private async trackActiveUser(
    projectId: string,
    userId: string,
  ): Promise<void> {
    const now = Date.now();
    const key = `active_users:${projectId}`;

    // Add user to sorted set with timestamp as score
    await this.redis.zadd(key, now, userId);
  }

  /**
   * Get active users count
   */
  async getActiveUsers(projectId: string): Promise<ActiveUsersStats> {
    const cacheKey = `stats:active_users:${projectId}`;
    const cached = await this.redis.get<ActiveUsersStats>(cacheKey);
    if (cached) return cached;

    const now = new Date();
    const intervals = {
      now: new Date(now.getTime() - 5 * 60 * 1000), // 5 minutes
      last5m: new Date(now.getTime() - 5 * 60 * 1000),
      last15m: new Date(now.getTime() - 15 * 60 * 1000),
      last30m: new Date(now.getTime() - 30 * 60 * 1000),
      last1h: new Date(now.getTime() - 60 * 60 * 1000),
      today: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
      thisWeek: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      thisMonth: new Date(now.getFullYear(), now.getMonth(), 1),
    };

    const results = await Promise.all([
      this.countActiveUsers(projectId, intervals.now, now),
      this.countActiveUsers(projectId, intervals.last5m, now),
      this.countActiveUsers(projectId, intervals.last15m, now),
      this.countActiveUsers(projectId, intervals.last30m, now),
      this.countActiveUsers(projectId, intervals.last1h, now),
      this.countUniqueUsers(projectId, intervals.today, now),
      this.countUniqueUsers(projectId, intervals.thisWeek, now),
      this.countUniqueUsers(projectId, intervals.thisMonth, now),
    ]);

    const stats: ActiveUsersStats = {
      now: results[0],
      last5m: results[1],
      last15m: results[2],
      last30m: results[3],
      last1h: results[4],
      today: results[5],
      thisWeek: results[6],
      thisMonth: results[7],
    };

    await this.redis.set(cacheKey, stats, 30); // Cache for 30 seconds

    return stats;
  }

  /**
   * Count active users (sessions with recent activity)
   * A session is considered active if last_activity is within the timeout (2 min)
   */
  private async countActiveUsers(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const result = await this.clickhouse.query<{ count: number }>(
      `SELECT count(DISTINCT session_id) as count
       FROM dex_monitoring.sessions FINAL
       WHERE project_id = {projectId:String}
         AND last_activity >= {from:DateTime64(3)}
         AND last_activity <= {to:DateTime64(3)}
         AND is_active = 1
         AND last_activity >= now64(3) - INTERVAL 2 MINUTE`,
      { projectId, from: from.toISOString(), to: to.toISOString() },
    );
    return result[0]?.count || 0;
  }

  /**
   * Count unique users
   */
  private async countUniqueUsers(
    projectId: string,
    from: Date,
    to: Date,
  ): Promise<number> {
    const result = await this.clickhouse.query<{ count: number }>(
      `SELECT count(DISTINCT coalesce(nullIf(user_id, ''), session_id)) as count
       FROM dex_monitoring.sessions FINAL
       WHERE project_id = {projectId:String}
         AND started_at >= {from:DateTime64(3)}
         AND started_at <= {to:DateTime64(3)}`,
      { projectId, from: from.toISOString(), to: to.toISOString() },
    );
    return result[0]?.count || 0;
  }

  /**
   * Get session statistics
   */
  async getSessionStats(
    projectId: string,
    from?: Date,
    to?: Date,
  ): Promise<SessionStats> {
    const now = new Date();
    const timeRange = {
      from: from || new Date(now.getTime() - 24 * 60 * 60 * 1000),
      to: to || now,
    };

    const cacheKey = `stats:sessions:${projectId}:${timeRange.from.toISOString()}:${timeRange.to.toISOString()}`;
    const cached = await this.redis.get<SessionStats>(cacheKey);
    if (cached) return cached;

    const [totals, byPlatform, byDevice, byCountry] = await Promise.all([
      this.clickhouse.query<{
        total: number;
        active: number;
        avg_duration: number;
        avg_page_views: number;
        bounce_count: number;
      }>(
        `SELECT 
          count() as total,
          -- Active = is_active AND last_activity within 2 minutes
          countIf(is_active = 1 AND last_activity >= now64(3) - INTERVAL 2 MINUTE) as active,
          avg(duration_ms) as avg_duration,
          avg(page_views) as avg_page_views,
          countIf(page_views <= 1) as bounce_count
         FROM dex_monitoring.sessions FINAL
         WHERE project_id = {projectId:String}
           AND started_at >= {from:DateTime64(3)}
           AND started_at <= {to:DateTime64(3)}`,
        { projectId, ...timeRange },
      ),
      this.clickhouse.query<{ platform: string; count: number }>(
        `SELECT platform, count() as count
         FROM dex_monitoring.sessions FINAL
         WHERE project_id = {projectId:String}
           AND started_at >= {from:DateTime64(3)}
           AND started_at <= {to:DateTime64(3)}
         GROUP BY platform`,
        { projectId, ...timeRange },
      ),
      this.clickhouse.query<{ device_type: string; count: number }>(
        `SELECT device_type, count() as count
         FROM dex_monitoring.sessions FINAL
         WHERE project_id = {projectId:String}
           AND started_at >= {from:DateTime64(3)}
           AND started_at <= {to:DateTime64(3)}
         GROUP BY device_type`,
        { projectId, ...timeRange },
      ),
      this.clickhouse.query<{ country: string; count: number }>(
        `SELECT country, count() as count
         FROM dex_monitoring.sessions FINAL
         WHERE project_id = {projectId:String}
           AND started_at >= {from:DateTime64(3)}
           AND started_at <= {to:DateTime64(3)}
           AND country != ''
         GROUP BY country
         ORDER BY count DESC
         LIMIT 10`,
        { projectId, ...timeRange },
      ),
    ]);

    const total = totals[0]?.total || 0;
    const stats: SessionStats = {
      totalSessions: total,
      activeSessions: totals[0]?.active || 0,
      avgDurationMs: totals[0]?.avg_duration || 0,
      avgPageViews: totals[0]?.avg_page_views || 0,
      bounceRate: total > 0 ? (totals[0]?.bounce_count || 0) / total : 0,
      byPlatform: Object.fromEntries(
        byPlatform.map((r) => [r.platform, r.count]),
      ),
      byDevice: Object.fromEntries(
        byDevice.map((r) => [r.device_type, r.count]),
      ),
      byCountry: Object.fromEntries(byCountry.map((r) => [r.country, r.count])),
    };

    await this.redis.set(cacheKey, stats, 60);

    return stats;
  }

  /**
   * Get top pages
   */
  async getTopPages(
    projectId: string,
    limit: number = 10,
    from?: Date,
    to?: Date,
  ): Promise<Array<{ path: string; views: number; avgTimeMs: number }>> {
    const now = new Date();
    const timeRange = {
      from: from || new Date(now.getTime() - 24 * 60 * 60 * 1000),
      to: to || now,
    };

    const result = await this.clickhouse.query<{
      path: string;
      views: number;
      avg_time: number;
    }>(
      `SELECT 
        coalesce(nullIf(page_path, ''), screen_name) as path,
        count() as views,
        avg(time_on_page_ms) as avg_time
       FROM dex_monitoring.page_views
       WHERE project_id = {projectId:String}
         AND timestamp >= {from:DateTime64(3)}
         AND timestamp <= {to:DateTime64(3)}
       GROUP BY path
       ORDER BY views DESC
       LIMIT {limit:UInt32}`,
      { projectId, limit, ...timeRange },
    );

    return result.map((r) => ({
      path: r.path,
      views: r.views,
      avgTimeMs: r.avg_time,
    }));
  }

  /**
   * Session timeout in milliseconds (2 minutes)
   * A session is considered inactive if last_activity is older than this
   */
  private readonly SESSION_TIMEOUT_MS = 2 * 60 * 1000;

  /**
   * Check if a session is actually active (considering timeout)
   */
  private isSessionActive(session: ClickHouseSession): boolean {
    if (session.is_active === 0) return false;

    const lastActivity = new Date(session.last_activity);
    const now = new Date();
    return now.getTime() - lastActivity.getTime() < this.SESSION_TIMEOUT_MS;
  }

  /**
   * List sessions with pagination
   * Note: is_active considers both the stored flag AND timeout (2 min since last_activity)
   */
  async listSessions(
    projectId: string,
    params: {
      userId?: string;
      isActive?: boolean;
      platform?: string;
      from?: Date;
      to?: Date;
      skip?: number;
      take?: number;
    },
  ): Promise<{ data: ClickHouseSession[]; total: number }> {
    const {
      userId,
      isActive,
      platform,
      from,
      to,
      skip = 0,
      take = 50,
    } = params;

    const conditions: string[] = ['project_id = {projectId:String}'];
    const queryParams: Record<string, unknown> = { projectId, skip, take };

    if (userId) {
      conditions.push('user_id = {userId:String}');
      queryParams.userId = userId;
    }

    // For active filter, also check timeout (2 minutes)
    if (typeof isActive === 'boolean') {
      if (isActive) {
        // Active: is_active = 1 AND last_activity within 2 minutes
        conditions.push('is_active = 1');
        conditions.push('last_activity >= now64(3) - INTERVAL 2 MINUTE');
      } else {
        // Inactive: is_active = 0 OR last_activity older than 2 minutes
        conditions.push(
          '(is_active = 0 OR last_activity < now64(3) - INTERVAL 2 MINUTE)',
        );
      }
    }

    if (platform) {
      conditions.push('platform = {platform:String}');
      queryParams.platform = platform;
    }

    if (from) {
      conditions.push('started_at >= {from:DateTime64(3)}');
      queryParams.from = from.toISOString();
    }

    if (to) {
      conditions.push('started_at <= {to:DateTime64(3)}');
      queryParams.to = to.toISOString();
    }

    const whereClause = conditions.join(' AND ');

    const [sessions, totalResult] = await Promise.all([
      this.clickhouse.query<ClickHouseSession>(
        `SELECT 
          *,
          -- Compute real active status based on timeout
          if(is_active = 1 AND last_activity >= now64(3) - INTERVAL 2 MINUTE, 1, 0) as computed_is_active
         FROM dex_monitoring.sessions FINAL
         WHERE ${whereClause}
         ORDER BY last_activity DESC
         LIMIT {take:UInt32} OFFSET {skip:UInt32}`,
        queryParams,
      ),
      this.clickhouse.query<{ count: number }>(
        `SELECT count() as count FROM dex_monitoring.sessions FINAL
         WHERE ${whereClause}`,
        queryParams,
      ),
    ]);

    // Override is_active with computed value
    const processedSessions = sessions.map((s) => ({
      ...s,
      is_active:
        (s as ClickHouseSession & { computed_is_active: number })
          .computed_is_active ?? (this.isSessionActive(s) ? 1 : 0),
    }));

    return { data: processedSessions, total: totalResult[0]?.count || 0 };
  }
}
