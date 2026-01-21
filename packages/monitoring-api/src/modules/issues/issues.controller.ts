import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { IssuesClickHouseService, ClickHouseIssue, ListIssuesParams, IssueStats } from './issues-clickhouse.service.js';
import { IssuesService } from './issues.service.js';
import { EventsClickHouseService, ClickHouseEvent } from '../events/events-clickhouse.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';
import type { IssueComment, Activity } from '@prisma/client';

// Frontend-compatible Event interface
interface TransformedEvent {
  id: string;
  eventId: string;
  message: string;
  level: string;
  environment: string;
  timestamp: string;
  release?: string;
  serverName?: string;
  transaction?: string;
  userId?: string;
  userEmail?: string;
  userIp?: string;
  requestUrl?: string;
  requestMethod?: string;
  stacktrace: unknown[];
  breadcrumbs: unknown[];
  contexts: Record<string, unknown>;
  tags: Record<string, string>;
  extra: Record<string, unknown>;
}

// Frontend-compatible Issue interface (camelCase)
interface Issue {
  id: string;
  projectId: string;
  shortId: string;
  fingerprint: string;
  title: string;
  culprit: string;
  type: string;
  level: string;
  status: string;
  platform: string;
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  userCount: number;
  environments: string[];
  releases: string[];
  sampleEventId: string;
  sampleStacktrace: string;
  metadata?: Record<string, unknown>;
  tags?: Record<string, string>;
}

interface RequestWithUser extends Request {
  user: { id: string };
}

@ApiTags('Issues')
@ApiBearerAuth('JWT')
@Controller('issues')
@UseGuards(AuthGuard('jwt'))
export class IssuesController {
  constructor(
    private readonly issuesClickHouse: IssuesClickHouseService,
    private readonly issuesService: IssuesService,
    private readonly eventsClickHouse: EventsClickHouseService,
  ) {}

  /**
   * GET /issues
   * List all issues from ClickHouse with filtering
   * projectId is optional - if not provided, returns issues from all projects
   */
  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('level') level?: string,
    @Query('platform') platform?: string,
    @Query('environment') environment?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: 'lastSeen' | 'firstSeen' | 'eventCount' | 'userCount',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc'
  ): Promise<ApiResponse<PaginatedResponse<Issue>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '20', 10);

    // Map camelCase sortBy to snake_case for ClickHouse
    const sortByMap: Record<string, 'last_seen' | 'first_seen' | 'event_count' | 'user_count'> = {
      lastSeen: 'last_seen',
      firstSeen: 'first_seen',
      eventCount: 'event_count',
      userCount: 'user_count',
    };

    const params: ListIssuesParams = {
      projectId,
      status,
      level,
      platform,
      environment,
      search,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      skip: (pageNum - 1) * size,
      take: size,
      sortBy: sortBy ? sortByMap[sortBy] : undefined,
      sortOrder,
    };

    const { data, total } = await this.issuesClickHouse.list(params);

    // Transform snake_case to camelCase for frontend compatibility
    const transformedData = data.map(issue => this.transformIssue(issue));

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
   * Transform ClickHouse issue (snake_case) to frontend format (camelCase)
   */
  private transformIssue(issue: ClickHouseIssue): Issue {
    return {
      id: issue.id,
      projectId: issue.project_id,
      shortId: issue.short_id,
      fingerprint: issue.fingerprint,
      title: issue.title,
      culprit: issue.culprit,
      type: issue.type,
      level: issue.level,
      status: issue.status,
      platform: issue.platform || 'node',
      firstSeen: issue.first_seen,
      lastSeen: issue.last_seen,
      eventCount: issue.event_count,
      userCount: issue.user_count,
      environments: issue.environments || [],
      releases: issue.releases || [],
      sampleEventId: issue.sample_event_id,
      sampleStacktrace: issue.sample_stacktrace,
      metadata: {},
      tags: {},
    };
  }

  /**
   * GET /issues/stats
   * Get issue statistics from ClickHouse
   */
  @Get('stats')
  async getStats(
    @Query('projectId') projectId: string
  ): Promise<ApiResponse<IssueStats>> {
    const stats = await this.issuesClickHouse.getStats(projectId);
    return { success: true, data: stats };
  }

  /**
   * GET /issues/:id
   * Get a single issue from ClickHouse by ID or shortId, including events
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query('projectId') projectId?: string
  ): Promise<ApiResponse<Issue & { events: TransformedEvent[] }>> {
    // Try by UUID first
    let issue = await this.issuesClickHouse.findById(id);
    
    // If not found and projectId provided, try by shortId
    if (!issue && projectId) {
      issue = await this.issuesClickHouse.findByShortId(projectId, id);
    }

    if (!issue) {
      throw new NotFoundException('Issue not found');
    }

    // Fetch events for this issue
    const { data: events } = await this.eventsClickHouse.findByIssue(issue.id, { skip: 0, take: 20 });
    const transformedEvents = events.map(e => this.transformEvent(e));

    return { 
      success: true, 
      data: {
        ...this.transformIssue(issue),
        events: transformedEvents,
      }
    };
  }

  /**
   * Transform ClickHouse event to frontend format
   */
  private transformEvent(event: ClickHouseEvent): TransformedEvent {
    return {
      id: event.id,
      eventId: event.event_id,
      message: event.value,
      level: event.level,
      environment: event.environment,
      timestamp: event.timestamp,
      release: event.release || undefined,
      serverName: event.server_name || undefined,
      transaction: event.transaction || undefined,
      userId: event.user_id || undefined,
      userEmail: event.user_email || undefined,
      userIp: event.user_ip || undefined,
      requestUrl: event.request_url || undefined,
      requestMethod: event.request_method || undefined,
      stacktrace: event.stacktrace ? JSON.parse(event.stacktrace) : [],
      breadcrumbs: event.breadcrumbs ? JSON.parse(event.breadcrumbs) : [],
      contexts: event.contexts ? JSON.parse(event.contexts) : {},
      tags: event.tags ? JSON.parse(event.tags) : {},
      extra: event.extra ? JSON.parse(event.extra) : {},
    };
  }

  /**
   * POST /issues/:id/resolve
   * Resolve an issue
   */
  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<ClickHouseIssue>> {
    const issue = await this.issuesClickHouse.updateStatus(id, 'RESOLVED');
    
    // Track activity in PostgreSQL
    await this.issuesService.trackActivity(id, req.user.id, 'RESOLVED', {
      action: 'status_change',
      newStatus: 'RESOLVED',
    });

    return { success: true, data: issue };
  }

  /**
   * POST /issues/:id/unresolve
   * Reopen an issue
   */
  @Post(':id/unresolve')
  async unresolve(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<ClickHouseIssue>> {
    const issue = await this.issuesClickHouse.updateStatus(id, 'UNRESOLVED');
    
    await this.issuesService.trackActivity(id, req.user.id, 'UNRESOLVED', {
      action: 'status_change',
      newStatus: 'UNRESOLVED',
    });

    return { success: true, data: issue };
  }

  /**
   * POST /issues/:id/ignore
   * Ignore an issue
   */
  @Post(':id/ignore')
  async ignore(
    @Param('id') id: string,
    @Body() body: { reason?: string; until?: string },
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<ClickHouseIssue>> {
    const issue = await this.issuesClickHouse.updateStatus(id, 'IGNORED');
    
    await this.issuesService.trackActivity(id, req.user.id, 'IGNORED', {
      action: 'status_change',
      newStatus: 'IGNORED',
      reason: body.reason,
      until: body.until,
    });

    return { success: true, data: issue };
  }

  /**
   * POST /issues/:id/unignore
   * Stop ignoring an issue
   */
  @Post(':id/unignore')
  async unignore(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<ClickHouseIssue>> {
    const issue = await this.issuesClickHouse.updateStatus(id, 'UNRESOLVED');
    
    await this.issuesService.trackActivity(id, req.user.id, 'UNRESOLVED', {
      action: 'status_change',
      newStatus: 'UNRESOLVED',
      previousStatus: 'IGNORED',
    });

    return { success: true, data: issue };
  }

  /**
   * POST /issues/:id/merge
   * Merge other issues into this one
   */
  @Post(':id/merge')
  async merge(
    @Param('id') id: string,
    @Body() body: { issueIds: string[] },
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<ClickHouseIssue>> {
    const issue = await this.issuesClickHouse.merge(id, body.issueIds);
    
    await this.issuesService.trackActivity(id, req.user.id, 'MERGED', {
      action: 'merge',
      mergedIssueIds: body.issueIds,
    });

    return { success: true, data: issue };
  }

  /**
   * DELETE /issues/:id
   * Delete an issue
   */
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<ApiResponse<{ message: string }>> {
    await this.issuesClickHouse.delete(id);
    return { success: true, data: { message: 'Issue deleted' } };
  }

  /**
   * POST /issues/bulk/resolve
   * Resolve multiple issues at once
   */
  @Post('bulk/resolve')
  async bulkResolve(
    @Body() body: { issueIds: string[] },
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<{ updated: number; failed: string[] }>> {
    const result = await this.issuesClickHouse.bulkUpdateStatus(body.issueIds, 'RESOLVED');

    // Track activity for successfully updated issues
    const successfulIds = body.issueIds.filter(id => !result.failed.includes(id));
    for (const issueId of successfulIds) {
      await this.issuesService.trackActivity(issueId, req.user.id, 'RESOLVED', {
        action: 'bulk_status_change',
        newStatus: 'RESOLVED',
      });
    }

    return { success: true, data: result };
  }

  /**
   * POST /issues/bulk/unresolve
   * Unresolve multiple issues at once
   */
  @Post('bulk/unresolve')
  async bulkUnresolve(
    @Body() body: { issueIds: string[] },
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<{ updated: number; failed: string[] }>> {
    const result = await this.issuesClickHouse.bulkUpdateStatus(body.issueIds, 'UNRESOLVED');

    const successfulIds = body.issueIds.filter(id => !result.failed.includes(id));
    for (const issueId of successfulIds) {
      await this.issuesService.trackActivity(issueId, req.user.id, 'UNRESOLVED', {
        action: 'bulk_status_change',
        newStatus: 'UNRESOLVED',
      });
    }

    return { success: true, data: result };
  }

  /**
   * POST /issues/bulk/ignore
   * Ignore multiple issues at once
   */
  @Post('bulk/ignore')
  async bulkIgnore(
    @Body() body: { issueIds: string[]; reason?: string },
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<{ updated: number; failed: string[] }>> {
    const result = await this.issuesClickHouse.bulkUpdateStatus(body.issueIds, 'IGNORED');

    const successfulIds = body.issueIds.filter(id => !result.failed.includes(id));
    for (const issueId of successfulIds) {
      await this.issuesService.trackActivity(issueId, req.user.id, 'IGNORED', {
        action: 'bulk_status_change',
        newStatus: 'IGNORED',
        reason: body.reason,
      });
    }

    return { success: true, data: result };
  }

  /**
   * POST /issues/bulk/delete
   * Delete multiple issues at once
   */
  @Post('bulk/delete')
  async bulkDelete(
    @Body() body: { issueIds: string[] },
  ): Promise<ApiResponse<{ deleted: number; failed: string[] }>> {
    const result = await this.issuesClickHouse.bulkDelete(body.issueIds);
    return { success: true, data: result };
  }

  /**
   * GET /issues/:id/activity
   * Get activity log for an issue (from PostgreSQL)
   */
  @Get(':id/activity')
  async getActivity(@Param('id') id: string): Promise<ApiResponse<Activity[]>> {
    const activity = await this.issuesService.getActivity(id);
    return { success: true, data: activity };
  }

  /**
   * GET /issues/:id/comments
   * Get comments for an issue (from PostgreSQL)
   */
  @Get(':id/comments')
  async getComments(@Param('id') id: string): Promise<ApiResponse<IssueComment[]>> {
    const comments = await this.issuesService.getComments(id);
    return { success: true, data: comments };
  }

  /**
   * POST /issues/:id/comments
   * Add a comment to an issue (in PostgreSQL)
   */
  @Post(':id/comments')
  async addComment(
    @Param('id') id: string,
    @Body() body: { content: string },
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<IssueComment>> {
    const comment = await this.issuesService.addComment(id, req.user.id, body.content);
    return { success: true, data: comment };
  }
}
