import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestContextService, RequestContextData } from '@dex-monit/observability-request-context';

/**
 * Header names for request tracing
 */
export const REQUEST_ID_HEADER = 'x-request-id';
export const TRANSACTION_ID_HEADER = 'x-transaction-id';

/**
 * Middleware to generate request IDs and setup request context
 * 
 * This middleware:
 * 1. Extracts or generates a request ID
 * 2. Extracts or generates a transaction ID
 * 3. Sets up the AsyncLocalStorage context for the request
 * 4. Adds response headers for tracing
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Extract or generate request ID
    const requestId = (req.headers[REQUEST_ID_HEADER] as string) || uuidv4();
    
    // Extract or generate transaction ID (for distributed tracing)
    const transactionId = 
      (req.headers[TRANSACTION_ID_HEADER] as string) || uuidv4();

    // Set response headers
    res.setHeader(REQUEST_ID_HEADER, requestId);
    res.setHeader(TRANSACTION_ID_HEADER, transactionId);

    // Create request context
    const context: RequestContextData = {
      requestId,
      transactionId,
      startTime: Date.now(),
      metadata: {
        method: req.method,
        url: req.originalUrl,
        userAgent: req.headers['user-agent'],
      },
    };

    // Run the rest of the middleware chain within the context
    RequestContextService.run(context, () => {
      next();
    });
  }
}
