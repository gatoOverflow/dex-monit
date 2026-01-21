import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiSecurity, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { IngestService } from './ingest.service.js';
import { ApiKeysService } from '../projects/api-keys.service.js';
import { IngestErrorDto, IngestLogDto, IngestLogsBatchDto } from './dto/index.js';
import type { ApiResponse } from '@dex-monit/observability-contracts';
import type { IngestResult } from '../events/events.service.js';

/**
 * Ingest Controller
 *
 * Public endpoints for SDK ingestion.
 * Uses API key authentication instead of JWT.
 */
@ApiTags('Ingest')
@ApiSecurity('X-Dex-Key')
@ApiHeader({ name: 'X-Dex-Key', description: 'Project API Key', required: true })
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingestService: IngestService,
    private readonly apiKeysService: ApiKeysService
  ) {}

  /**
   * GET /ingest/ping
   * Health check endpoint to validate API key and connectivity
   * Used by SDKs to verify configuration at startup
   */
  @Get('ping')
  @ApiOperation({
    summary: 'Validate API key and connectivity',
    description: 'Used by SDKs to verify configuration at startup. Returns project info if valid.'
  })
  async ping(
    @Headers('authorization') authHeader?: string,
    @Headers('x-dex-key') dsnKey?: string
  ): Promise<ApiResponse<{ project: string; projectId: string; environment: string }>> {
    const apiKey = this.extractApiKey(authHeader, dsnKey);

    // Validate API key and get project info
    const key = await this.apiKeysService.validateKey(apiKey, ['ingest']);

    return {
      success: true,
      data: {
        project: (key as any).project?.name || 'Unknown',
        projectId: key.projectId,
        environment: process.env['NODE_ENV'] || 'development',
      },
    };
  }

  /**
   * Extract API key from headers
   */
  private extractApiKey(authHeader?: string, dsnKey?: string): string {
    // Try X-Dex-Key header first
    if (dsnKey) {
      return dsnKey;
    }

    // Try Authorization header (Bearer token)
    if (authHeader?.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }

    // Try Basic auth
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.substring(6), 'base64').toString();
      const [key] = decoded.split(':');
      return key;
    }

    throw new UnauthorizedException('API key required');
  }

  /**
   * POST /ingest/errors
   * Ingest an error event from SDK
   */
  @Post('errors')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async ingestError(
    @Body() event: IngestErrorDto,
    @Headers('authorization') authHeader?: string,
    @Headers('x-dex-key') dsnKey?: string
  ): Promise<ApiResponse<IngestResult>> {
    const apiKey = this.extractApiKey(authHeader, dsnKey);
    
    // Validate API key
    const key = await this.apiKeysService.validateKey(apiKey, ['ingest']);
    
    // Ingest the event
    const result = await this.ingestService.ingestError(event, key.projectId);
    
    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /ingest/logs
   * Ingest a single log event
   */
  @Post('logs')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async ingestLog(
    @Body() log: IngestLogDto,
    @Headers('authorization') authHeader?: string,
    @Headers('x-dex-key') dsnKey?: string
  ): Promise<ApiResponse<{ id: string }>> {
    const apiKey = this.extractApiKey(authHeader, dsnKey);
    
    // Validate API key
    const key = await this.apiKeysService.validateKey(apiKey, ['ingest']);
    
    // Ingest the log
    const result = await this.ingestService.ingestLog(log, key.projectId);
    
    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /ingest/logs/batch
   * Ingest multiple log events (max 1000 per batch)
   */
  @Post('logs/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async ingestLogsBatch(
    @Body() body: IngestLogsBatchDto,
    @Headers('authorization') authHeader?: string,
    @Headers('x-dex-key') dsnKey?: string
  ): Promise<ApiResponse<{ count: number }>> {
    const apiKey = this.extractApiKey(authHeader, dsnKey);
    
    // Validate API key
    const key = await this.apiKeysService.validateKey(apiKey, ['ingest']);
    
    // Ingest logs
    const result = await this.ingestService.ingestLogs(body.logs, key.projectId);
    
    return {
      success: true,
      data: result,
    };
  }
}
