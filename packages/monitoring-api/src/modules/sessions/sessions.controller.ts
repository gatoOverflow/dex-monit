import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import {
  SessionsClickHouseService,
  CreateSessionDto,
  CreatePageViewDto,
  ClickHouseSession,
  ActiveUsersStats,
  SessionStats,
} from './sessions-clickhouse.service.js';
import { ApiKeysService } from '../projects/api-keys.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';

// Frontend-compatible interfaces
interface Session {
  id: string;
  sessionId: string;
  userId: string;
  startedAt: string;
  endedAt: string;
  lastActivity: string;
  durationMs: number;
  isActive: boolean;
  platform: string;
  deviceType: string;
  deviceBrand: string;
  deviceModel: string;
  osName: string;
  osVersion: string;
  appVersion: string;
  browser: string;
  browserVersion: string;
  ip: string;
  country: string;
  city: string;
  pageViews: number;
  eventsCount: number;
  errorsCount: number;
  entryPage: string;
  exitPage: string;
  referrer: string;
}

@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly sessionsService: SessionsClickHouseService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  /**
   * POST /sessions/start
   * Start or update a session (SDK auth)
   */
  @Post('start')
  @HttpCode(HttpStatus.ACCEPTED)
  async startSession(
    @Body() data: CreateSessionDto,
    @Headers('x-dex-key') apiKey: string,
    @Req() req: Request,
  ): Promise<ApiResponse<{ sessionId: string }>> {
    const key = await this.apiKeysService.validateKey(apiKey);
    if (!key) {
      return { success: false, error: 'Invalid API key' };
    }

    // Extract IP from request headers (handles proxies)
    const ip = this.extractIP(req);

    await this.sessionsService.startSession(key.projectId, {
      ...data,
      ip,
    });

    return { success: true, data: { sessionId: data.sessionId } };
  }

  /**
   * Extract client IP from request (handles proxies/load balancers)
   */
  private extractIP(req: Request): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
      const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      return ips.trim();
    }
    const realIp = req.headers['x-real-ip'];
    if (realIp) {
      return Array.isArray(realIp) ? realIp[0] : realIp;
    }
    return req.ip || req.socket?.remoteAddress || '';
  }

  /**
   * POST /sessions/identify
   * Identify/update user for current session (SDK auth)
   */
  @Post('identify')
  @HttpCode(HttpStatus.ACCEPTED)
  async identifyUser(
    @Body() data: { sessionId: string; userId?: string; userEmail?: string; userName?: string },
    @Headers('x-dex-key') apiKey: string,
  ): Promise<ApiResponse<{ ok: boolean }>> {
    const key = await this.apiKeysService.validateKey(apiKey);
    if (!key) {
      return { success: false, error: 'Invalid API key' };
    }

    await this.sessionsService.identifyUser(key.projectId, data.sessionId, {
      userId: data.userId,
      email: data.userEmail,
      name: data.userName,
    });

    return { success: true, data: { ok: true } };
  }

  /**
   * POST /sessions/heartbeat
   * Update session activity (SDK auth)
   */
  @Post('heartbeat')
  @HttpCode(HttpStatus.ACCEPTED)
  async heartbeat(
    @Body() data: { sessionId: string; currentPage?: string },
    @Headers('x-dex-key') apiKey: string,
  ): Promise<ApiResponse<{ ok: boolean }>> {
    const key = await this.apiKeysService.validateKey(apiKey);
    if (!key) {
      return { success: false, error: 'Invalid API key' };
    }

    await this.sessionsService.updateSessionActivity(
      key.projectId,
      data.sessionId,
      data.currentPage,
    );

    return { success: true, data: { ok: true } };
  }

  /**
   * POST /sessions/end
   * End a session (SDK auth)
   */
  @Post('end')
  @HttpCode(HttpStatus.ACCEPTED)
  async endSession(
    @Body() data: { sessionId: string },
    @Headers('x-dex-key') apiKey: string,
  ): Promise<ApiResponse<{ ok: boolean }>> {
    const key = await this.apiKeysService.validateKey(apiKey);
    if (!key) {
      return { success: false, error: 'Invalid API key' };
    }

    await this.sessionsService.endSession(key.projectId, data.sessionId);

    return { success: true, data: { ok: true } };
  }

  /**
   * POST /sessions/pageview
   * Track a page view (SDK auth)
   */
  @Post('pageview')
  @HttpCode(HttpStatus.ACCEPTED)
  async trackPageView(
    @Body() data: CreatePageViewDto,
    @Headers('x-dex-key') apiKey: string,
  ): Promise<ApiResponse<{ id: string }>> {
    const key = await this.apiKeysService.validateKey(apiKey);
    if (!key) {
      return { success: false, error: 'Invalid API key' };
    }

    const id = await this.sessionsService.trackPageView(key.projectId, data);

    return { success: true, data: { id } };
  }

  /**
   * GET /sessions/active-users
   * Get active users statistics (JWT auth)
   */
  @Get('active-users')
  @UseGuards(AuthGuard('jwt'))
  async getActiveUsers(
    @Query('projectId') projectId: string,
  ): Promise<ApiResponse<ActiveUsersStats>> {
    const stats = await this.sessionsService.getActiveUsers(projectId);
    return { success: true, data: stats };
  }

  /**
   * GET /sessions/stats
   * Get session statistics (JWT auth)
   */
  @Get('stats')
  @UseGuards(AuthGuard('jwt'))
  async getStats(
    @Query('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ApiResponse<SessionStats>> {
    const stats = await this.sessionsService.getSessionStats(
      projectId,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
    return { success: true, data: stats };
  }

  /**
   * GET /sessions/top-pages
   * Get top pages (JWT auth)
   */
  @Get('top-pages')
  @UseGuards(AuthGuard('jwt'))
  async getTopPages(
    @Query('projectId') projectId: string,
    @Query('limit') limit?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<ApiResponse<Array<{ path: string; views: number; avgTimeMs: number }>>> {
    const pages = await this.sessionsService.getTopPages(
      projectId,
      limit ? parseInt(limit, 10) : 10,
      from ? new Date(from) : undefined,
      to ? new Date(to) : undefined,
    );
    return { success: true, data: pages };
  }

  /**
   * GET /sessions
   * List sessions (JWT auth)
   */
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async list(
    @Query('projectId') projectId: string,
    @Query('userId') userId?: string,
    @Query('isActive') isActive?: string,
    @Query('platform') platform?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<PaginatedResponse<Session>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '50', 10);

    const { data, total } = await this.sessionsService.listSessions(projectId, {
      userId,
      isActive: isActive ? isActive === 'true' : undefined,
      platform,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      skip: (pageNum - 1) * size,
      take: size,
    });

    const transformedData = data.map((s) => this.transformSession(s));

    return {
      success: true,
      data: {
        data: transformedData,
        meta: {
          page: pageNum,
          pageSize: size,
          total,
          totalPages: Math.ceil(total / size),
        },
      },
    };
  }

  /**
   * GET /sessions/:id
   * Get a single session (JWT auth)
   */
  @Get(':sessionId')
  @UseGuards(AuthGuard('jwt'))
  async getSession(
    @Param('sessionId') sessionId: string,
    @Query('projectId') projectId: string,
  ): Promise<ApiResponse<Session | null>> {
    const { data } = await this.sessionsService.listSessions(projectId, {
      skip: 0,
      take: 1,
    });

    // Filter by session_id in the result (since we can't easily query by session_id)
    const session = data.find((s) => s.session_id === sessionId);

    return {
      success: true,
      data: session ? this.transformSession(session) : null,
    };
  }

  /**
   * Transform ClickHouse session to frontend format
   */
  private transformSession(session: ClickHouseSession): Session {
    return {
      id: session.id,
      sessionId: session.session_id,
      userId: session.user_id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      lastActivity: session.last_activity,
      durationMs: session.duration_ms,
      isActive: session.is_active === 1,
      platform: session.platform,
      deviceType: session.device_type,
      deviceBrand: session.device_brand || '',
      deviceModel: session.device_model || '',
      osName: session.os_name,
      osVersion: session.os_version,
      appVersion: session.app_version,
      browser: session.browser,
      browserVersion: session.browser_version,
      ip: session.ip,
      country: session.country,
      city: session.city,
      pageViews: session.page_views,
      eventsCount: session.events_count,
      errorsCount: session.errors_count,
      entryPage: session.entry_page,
      exitPage: session.exit_page,
      referrer: session.referrer,
    };
  }
}
