import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { RequestContextService } from '@dex-monit/observability-request-context';
import { Logger } from '@dex-monit/observability-logger';
import { MonitoringClient } from './monitoring-client.js';

/**
 * Error response structure
 */
interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  requestId?: string;
  timestamp: string;
}

/**
 * Global Exception Filter
 * 
 * Catches all unhandled exceptions, logs them, and sends them to the monitoring service.
 * Returns a standardized error response with request ID for correlation.
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly monitoringClient?: MonitoringClient
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    console.log('[DEX SDK] GlobalExceptionFilter TRIGGERED');
    
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Get request context
    const requestContext = RequestContextService.get();
    const requestId = requestContext?.requestId;

    // Determine status code and error details
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let errorName = 'InternalServerError';
    let stack: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp['message'] as string) || message;
        errorName = (resp['error'] as string) || exception.name;
      }
      
      errorName = exception.name;
      stack = exception.stack;
    } else if (exception instanceof Error) {
      message = exception.message;
      errorName = exception.name;
      stack = exception.stack;
    }

    // Log the error
    this.logger.error(message, {
      error: {
        name: errorName,
        message,
        stack,
      },
      statusCode,
      path: request.url,
      method: request.method,
    });

    // Send to monitoring service (async, don't wait)
    console.log('[DEX SDK] Checking monitoring client:', !!this.monitoringClient, 'statusCode:', statusCode);
    if (this.monitoringClient && statusCode >= 500) {
      console.log('[DEX SDK] Sending to monitoring service...');
      this.monitoringClient
        .captureException(exception instanceof Error ? exception : new Error(message), {
          request: {
            url: request.url,
            method: request.method,
            headers: this.sanitizeHeaders(request.headers as Record<string, string>),
            query: request.query as Record<string, string>,
          },
        })
        .catch((err) => {
          this.logger.warn('Failed to send error to monitoring service', {
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        });
    }

    // Build error response
    const errorResponse: ErrorResponse = {
      statusCode,
      message,
      error: errorName,
      requestId,
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(errorResponse);
  }

  /**
   * Remove sensitive headers before logging/sending
   */
  private sanitizeHeaders(headers: Record<string, string>): Record<string, string> {
    const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key'];
    const sanitized: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
      if (sensitiveHeaders.includes(key.toLowerCase())) {
        sanitized[key] = '[REDACTED]';
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}
