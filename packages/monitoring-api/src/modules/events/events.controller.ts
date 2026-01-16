import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  EventsClickHouseService,
  ClickHouseEvent,
} from './events-clickhouse.service.js';
import type {
  ApiResponse,
  PaginatedResponse,
} from '@dex-monit/observability-contracts';

// Frontend-compatible Event interface
interface Event {
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

/**
 * Transform ClickHouse event to frontend format
 */
function transformEvent(event: ClickHouseEvent): Event {
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

@Controller('events')
@UseGuards(AuthGuard('jwt'))
export class EventsController {
  constructor(private readonly eventsService: EventsClickHouseService) {}

  /**
   * GET /events/:eventId
   * Get a single event by ID
   */
  @Get(':eventId')
  async findOne(
    @Param('eventId') eventId: string,
  ): Promise<ApiResponse<Event | null>> {
    const event = await this.eventsService.findById(eventId);
    return { success: true, data: event ? transformEvent(event) : null };
  }
}

@Controller('issues/:issueId/events')
@UseGuards(AuthGuard('jwt'))
export class IssueEventsController {
  constructor(private readonly eventsService: EventsClickHouseService) {}

  /**
   * GET /issues/:issueId/events
   * Get events for an issue
   */
  @Get()
  async list(
    @Param('issueId') issueId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<ApiResponse<PaginatedResponse<Event>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '20', 10);

    const { data, total } = await this.eventsService.findByIssue(issueId, {
      skip: (pageNum - 1) * size,
      take: size,
    });

    return {
      success: true,
      data: {
        data: data.map(transformEvent),
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
   * GET /issues/:issueId/events/latest
   * Get the latest event for an issue (first one in list)
   */
  @Get('latest')
  async latest(
    @Param('issueId') issueId: string,
  ): Promise<ApiResponse<Event | null>> {
    const { data } = await this.eventsService.findByIssue(issueId, {
      skip: 0,
      take: 1,
    });
    return { success: true, data: data[0] ? transformEvent(data[0]) : null };
  }
}
