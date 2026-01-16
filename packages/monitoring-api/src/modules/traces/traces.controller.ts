import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Headers,
  UnauthorizedException,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TracesClickHouseService, ClickHouseTrace, CreateTraceDto, TraceStats } from './traces-clickhouse.service.js';
import { ApiKeysService } from '../projects/api-keys.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';

// Frontend-compatible trace interface
interface Trace {
  id: string;
  traceId: string;
  projectId: string;
  timestamp: string;
  method: string;
  url: string;
  path: string;
  statusCode: number;
  duration: number;
  ip?: string;
  userAgent?: string;
  referer?: string;
  requestSize?: number;
  responseSize?: number;
  requestId?: string;
  transactionId?: string;
  userId?: string;
  environment?: string;
  serverName?: string;
  error?: string;
  headers?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

@Controller('traces')
export class TracesController {
  constructor(
    private readonly tracesService: TracesClickHouseService,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  /**
   * Extract API key from headers
   */
  private extractApiKey(authHeader?: string, dsnKey?: string): string {
    if (dsnKey) {
      return dsnKey;
    }
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }
    throw new UnauthorizedException('API key required');
  }

  /**
   * POST /traces
   * Ingest HTTP traces to ClickHouse (API key auth)
   */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(
    @Body() body: CreateTraceDto | CreateTraceDto[],
    @Headers('authorization') authHeader?: string,
    @Headers('x-dex-key') dsnKey?: string,
  ): Promise<ApiResponse<{ received: number }>> {
    const apiKey = this.extractApiKey(authHeader, dsnKey);

    // Validate API key
    const key = await this.apiKeysService.validateKey(apiKey, ['ingest']);

    const traces = Array.isArray(body) ? body : [body];
    const count = await this.tracesService.ingestBatch(key.projectId, traces);

    return {
      success: true,
      data: { received: count },
    };
  }

  /**
   * Transform ClickHouse trace to frontend format
   */
  private transformTrace(trace: ClickHouseTrace): Trace {
    return {
      id: trace.id,
      traceId: trace.trace_id,
      projectId: trace.project_id,
      timestamp: trace.timestamp,
      method: trace.method,
      url: trace.url,
      path: trace.path,
      statusCode: trace.status_code,
      duration: trace.duration_ms,
      ip: trace.ip || undefined,
      userAgent: trace.user_agent || undefined,
      referer: trace.referer || undefined,
      requestSize: trace.request_size || undefined,
      responseSize: trace.response_size || undefined,
      requestId: trace.request_id || undefined,
      transactionId: trace.transaction_id || undefined,
      userId: trace.user_id || undefined,
      environment: trace.environment || undefined,
      serverName: trace.server_name || undefined,
      error: trace.error || undefined,
      headers: trace.headers ? JSON.parse(trace.headers) : undefined,
      query: trace.query_params ? JSON.parse(trace.query_params) : undefined,
    };
  }

  /**
   * GET /traces
   * List traces from ClickHouse (JWT auth)
   */
  @Get()
  @UseGuards(AuthGuard('jwt'))
  async list(
    @Query('projectId') projectId: string,
    @Query('method') method?: string,
    @Query('statusCode') statusCode?: string,
    @Query('minDuration') minDuration?: string,
    @Query('maxDuration') maxDuration?: string,
    @Query('path') path?: string,
    @Query('hasError') hasError?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: 'timestamp' | 'duration_ms' | 'status_code',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ): Promise<ApiResponse<PaginatedResponse<Trace>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '50', 10);

    const { data, total } = await this.tracesService.list({
      projectId,
      method,
      statusCode: statusCode ? parseInt(statusCode, 10) : undefined,
      minDuration: minDuration ? parseInt(minDuration, 10) : undefined,
      maxDuration: maxDuration ? parseInt(maxDuration, 10) : undefined,
      path,
      hasError: hasError ? hasError === 'true' : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      skip: (pageNum - 1) * size,
      take: size,
      sortBy,
      sortOrder,
    });

    // Transform to frontend format
    const transformedData = data.map(trace => this.transformTrace(trace));

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
   * GET /traces/stats
   * Get trace statistics from ClickHouse
   */
  @Get('stats')
  @UseGuards(AuthGuard('jwt'))
  async getStats(
    @Query('projectId') projectId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ApiResponse<TraceStats>> {
    const stats = await this.tracesService.getStats(
      projectId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * GET /traces/timeline
   * Get traces timeline for charts
   */
  @Get('timeline')
  @UseGuards(AuthGuard('jwt'))
  async getTimeline(
    @Query('projectId') projectId: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('interval') interval?: 'minute' | 'hour' | 'day',
  ): Promise<ApiResponse<Array<{
    timestamp: string;
    count: number;
    avgDuration: number;
    errorCount: number;
  }>>> {
    const timeline = await this.tracesService.getTimeline(
      projectId,
      new Date(startDate),
      new Date(endDate),
      interval || 'hour',
    );

    return {
      success: true,
      data: timeline,
    };
  }

  /**
   * GET /traces/live
   * Get live stats (last minute, no cache)
   */
  @Get('live')
  @UseGuards(AuthGuard('jwt'))
  async getLiveStats(
    @Query('projectId') projectId: string,
  ): Promise<ApiResponse<{
    requestsLastMinute: number;
    avgDurationLastMinute: number;
    errorsLastMinute: number;
  }>> {
    const stats = await this.tracesService.getLiveStats(projectId);
    return { success: true, data: stats };
  }

  /**
   * GET /traces/:id
   * Get a single trace
   */
  @Get(':id')
  @UseGuards(AuthGuard('jwt'))
  async findOne(@Param('id') id: string): Promise<ApiResponse<Trace>> {
    const trace = await this.tracesService.findById(id);
    if (!trace) {
      throw new NotFoundException('Trace not found');
    }
    return { success: true, data: this.transformTrace(trace) };
  }
}
