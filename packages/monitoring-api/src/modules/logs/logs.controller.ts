import { Controller, Get, Query, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { LogsClickHouseService, ClickHouseLog, ListLogsParams } from './logs-clickhouse.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';

// Frontend-compatible Log interface
interface Log {
  id: string;
  level: string;
  message: string;
  environment: string;
  serverName?: string;
  serviceName?: string;
  requestId?: string;
  transactionId?: string;
  timestamp: string;
  data?: Record<string, unknown>;
  tags?: Record<string, string>;
}

@Controller('logs')
@UseGuards(AuthGuard('jwt'))
export class LogsController {
  constructor(private readonly logsService: LogsClickHouseService) {}

  /**
   * Transform ClickHouse log to frontend format
   */
  private transformLog(log: ClickHouseLog): Log {
    return {
      id: log.id,
      level: log.level,
      message: log.message,
      environment: log.environment,
      serverName: log.host || undefined,
      serviceName: log.service || undefined,
      requestId: log.request_id || undefined,
      transactionId: log.transaction_id || undefined,
      timestamp: log.timestamp,
      data: log.attributes ? JSON.parse(log.attributes) : undefined,
    };
  }

  /**
   * GET /logs
   * List logs with filtering (from ClickHouse)
   */
  @Get()
  async list(
    @Query('projectId') projectId?: string,
    @Query('level') level?: string,
    @Query('environment') environment?: string,
    @Query('service') service?: string,
    @Query('requestId') requestId?: string,
    @Query('transactionId') transactionId?: string,
    @Query('search') search?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ): Promise<ApiResponse<PaginatedResponse<Log>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '100', 10);

    const params: ListLogsParams = {
      projectId,
      level,
      environment,
      service,
      requestId,
      transactionId,
      search,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      skip: (pageNum - 1) * size,
      take: size,
    };

    const { data, total } = await this.logsService.list(params);
    const transformedData = data.map(log => this.transformLog(log));

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
   * GET /logs/stats
   * Get log statistics (from ClickHouse)
   */
  @Get('stats')
  async getStats(
    @Query('projectId') projectId: string,
    @Query('from') from?: string,
    @Query('to') to?: string
  ): Promise<ApiResponse<{
    total: number;
    byLevel: Record<string, number>;
    byService: Record<string, number>;
    byHour: Array<{ hour: string; count: number }>;
    logsPerMinute: number;
  }>> {
    const now = new Date();
    const stats = await this.logsService.getStats(projectId, {
      from: from ? new Date(from) : new Date(now.getTime() - 24 * 60 * 60 * 1000),
      to: to ? new Date(to) : now,
    });
    return { success: true, data: stats };
  }

  /**
   * GET /logs/filters
   * Get available filter options
   */
  @Get('filters')
  async getFilters(
    @Query('projectId') projectId: string
  ): Promise<ApiResponse<{
    levels: string[];
    environments: string[];
    services: string[];
  }>> {
    const filters = await this.logsService.getFilterOptions(projectId);
    return { success: true, data: filters };
  }

  /**
   * GET /logs/search
   * Full-text search in logs
   */
  @Get('search')
  async search(
    @Query('projectId') projectId: string,
    @Query('q') query: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string
  ): Promise<ApiResponse<ClickHouseLog[]>> {
    const logs = await this.logsService.search(projectId, query, {
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      take: parseInt(limit || '100', 10),
    });
    return { success: true, data: logs };
  }

  /**
   * GET /logs/:id
   * Get a single log entry
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<Log | null>> {
    const log = await this.logsService.findById(id);
    return { success: true, data: log ? this.transformLog(log) : null };
  }

  /**
   * GET /logs/request/:requestId
   * Get all logs for a request
   */
  @Get('request/:requestId')
  async findByRequest(@Param('requestId') requestId: string): Promise<ApiResponse<Log[]>> {
    const logs = await this.logsService.findByRequestId(requestId);
    return { success: true, data: logs.map(log => this.transformLog(log)) };
  }

  /**
   * GET /logs/transaction/:transactionId
   * Get all logs for a transaction
   */
  @Get('transaction/:transactionId')
  async findByTransaction(
    @Param('transactionId') transactionId: string
  ): Promise<ApiResponse<Log[]>> {
    const logs = await this.logsService.findByTransactionId(transactionId);
    return { success: true, data: logs.map(log => this.transformLog(log)) };
  }
}
