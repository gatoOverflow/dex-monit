import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { IngestService } from './ingest.service.js';
import { ApiKeysService } from '../projects/api-keys.service.js';
import type { ErrorEvent, LogEvent, ApiResponse } from '@dex-monit/observability-contracts';
import type { IngestResult } from '../events/events.service.js';

/**
 * Ingest Controller
 * 
 * Public endpoints for SDK ingestion.
 * Uses API key authentication instead of JWT.
 */
@Controller('ingest')
export class IngestController {
  constructor(
    private readonly ingestService: IngestService,
    private readonly apiKeysService: ApiKeysService
  ) {}

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
  async ingestError(
    @Body() event: ErrorEvent,
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
  async ingestLog(
    @Body() log: LogEvent,
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
   * Ingest multiple log events
   */
  @Post('logs/batch')
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestLogsBatch(
    @Body() body: { logs: LogEvent[] },
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
