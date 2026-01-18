# @dex-monit/observability-sdk-node

NestJS SDK for Dex Monitoring - Automatic error tracking, log management, and HTTP tracing.

## Installation

```bash
npm install @dex-monit/observability-sdk-node
```

## Features

- ✅ **Automatic Error Capture** - Catches all unhandled exceptions
- ✅ **Console Capture** - Intercepts `console.log`, `console.warn`, `console.error`
- ✅ **NestJS Logger Capture** - Intercepts native `Logger.log`, `Logger.warn`, `Logger.error`
- ✅ **HTTP Request Tracing** - Records all incoming HTTP requests with timing
- ✅ **Request Context** - Automatic `requestId` propagation
- ✅ **Breadcrumbs** - Track events leading up to errors
- ✅ **Source Code Context** - Displays code snippets around errors
- ✅ **Zero Configuration** - Works out of the box

## Quick Start

### 1. Import the Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { SdkNodeModule } from '@dex-monit/observability-sdk-node';

@Module({
  imports: [
    SdkNodeModule.forRoot({
      logger: {
        serviceName: 'my-api',
        environment: process.env.NODE_ENV || 'development',
      },
      monitoring: {
        apiKey: process.env.DEX_MONITORING_API_KEY,
        apiUrl: process.env.DEX_MONITORING_API_URL || 'https://monit-api.example.com/api',
        project: 'my-project',
        environment: process.env.NODE_ENV || 'development',
      },
    }),
    // ... other modules
  ],
})
export class AppModule {}
```

### 2. That's It! 🎉

The SDK automatically:
- Captures all unhandled errors
- Captures all console logs
- Captures all NestJS Logger calls
- Records HTTP request traces
- Generates unique request IDs

## Configuration

### Full Configuration Options

```typescript
SdkNodeModule.forRoot({
  // Logger configuration
  logger: {
    serviceName: 'my-api',           // Required: Your service name
    environment: 'production',       // Required: Environment
    level: 'info',                   // Optional: Minimum log level (default: 'info')
  },
  
  // Monitoring client configuration
  monitoring: {
    apiKey: 'your-api-key',          // Required: API key from Dex Monitoring
    apiUrl: 'https://api.example.com/api', // Required: Monitoring API URL
    project: 'my-project',           // Required: Project identifier
    environment: 'production',       // Required: Environment
    release: '1.0.0',                // Optional: Release/version
    serverName: 'api-server-1',      // Optional: Server identifier
    debug: false,                    // Optional: Enable debug mode
  },
  
  // Optional settings
  remoteLogLevel: 'info',            // Minimum level to send remotely (default: 'debug')
  captureConsole: true,              // Capture console.* calls (default: true)
  captureNestLogger: true,           // Capture NestJS Logger (default: true)
  captureHttpRequests: true,         // Record HTTP traces (default: true)
});
```

## Using the Logger

### Option 1: DexLoggerService (Recommended)

```typescript
import { Injectable } from '@nestjs/common';
import { DexLoggerService, DEX_LOGGER_TOKEN } from '@dex-monit/observability-sdk-node';

@Injectable()
export class MyService {
  constructor(
    @Inject(DEX_LOGGER_TOKEN) private readonly logger: DexLoggerService,
  ) {}

  doSomething() {
    this.logger.log('Processing started', 'MyService');
    this.logger.debug('Debug info', 'MyService');
    this.logger.warn('Warning message', 'MyService');
    this.logger.error('Error occurred', 'stack trace', 'MyService');
  }
}
```

### Option 2: Native NestJS Logger (Auto-captured)

```typescript
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MyService {
  private readonly logger = new Logger(MyService.name);

  doSomething() {
    // These are automatically captured and sent to monitoring
    this.logger.log('Processing started');
    this.logger.warn('Warning message');
    this.logger.error('Error occurred');
  }
}
```

### Option 3: Console (Auto-captured)

```typescript
// These are automatically captured and sent to monitoring
console.log('Info message');
console.warn('Warning message');
console.error('Error message');
```

## Manual Error Capture

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { MonitoringClient, MONITORING_CLIENT_TOKEN } from '@dex-monit/observability-sdk-node';

@Injectable()
export class MyService {
  constructor(
    @Inject(MONITORING_CLIENT_TOKEN) private readonly monitoring: MonitoringClient,
  ) {}

  async processPayment() {
    try {
      await this.paymentGateway.charge();
    } catch (error) {
      // Manually capture with extra context
      this.monitoring.captureException(error, {
        user: { id: 'user-123', email: 'user@example.com' },
        tags: { component: 'payment', gateway: 'stripe' },
        extra: { orderId: 'order-456', amount: 99.99 },
      });
      throw error;
    }
  }
}
```

## Breadcrumbs

Track events leading up to errors:

```typescript
import { addBreadcrumb } from '@dex-monit/observability-sdk-node';

// Add a breadcrumb
addBreadcrumb({
  category: 'user.action',
  message: 'User clicked checkout button',
  level: 'info',
  data: { cartItems: 3 },
});

// HTTP breadcrumbs are added automatically for HTTP traces
```

## User Context

Set user information for error tracking:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { MonitoringClient, MONITORING_CLIENT_TOKEN } from '@dex-monit/observability-sdk-node';

@Injectable()
export class AuthService {
  constructor(
    @Inject(MONITORING_CLIENT_TOKEN) private readonly monitoring: MonitoringClient,
  ) {}

  onLogin(user: User) {
    this.monitoring.setUser({
      id: user.id,
      email: user.email,
      username: user.username,
    });
  }
}
```

## HTTP Tracing

HTTP requests are automatically traced with:
- Request method, URL, path
- Response status code
- Duration (ms)
- Client IP address
- User agent
- Headers (sensitive data scrubbed)
- Query parameters
- Request/response sizes

View traces in the Dex Monitoring dashboard under **Traces**.

## Request ID Propagation

The SDK automatically:
1. Generates a unique `requestId` for each request
2. Reads incoming `x-request-id` header (for distributed tracing)
3. Sets `x-request-id` on the response
4. Includes `requestId` in all logs and errors

## What Gets Captured

### Automatic Capture
| Type | Captured | Sent to |
|------|----------|---------|
| Unhandled exceptions | ✅ | Errors |
| Promise rejections | ✅ | Errors |
| `console.log/warn/error` | ✅ | Logs |
| `Logger.log/warn/error` | ✅ | Logs |
| HTTP requests | ✅ | Traces |

### Error Context
Each captured error includes:
- Full stack trace with source code context
- Request details (URL, method, headers, body)
- User information (if set)
- Breadcrumbs (recent events)
- Runtime info (Node.js version, memory)
- OS info (platform, version)
- Custom tags and extra data

## Environment Variables

```env
# Required
DEX_MONITORING_API_KEY=your-api-key
DEX_MONITORING_API_URL=https://monit-api.example.com/api

# Optional
NODE_ENV=production
```

## Disabling Features

```typescript
SdkNodeModule.forRoot({
  logger: { serviceName: 'my-api', environment: 'production' },
  monitoring: { /* ... */ },
  
  // Disable specific features
  captureConsole: false,        // Don't capture console.*
  captureNestLogger: false,     // Don't capture NestJS Logger
  captureHttpRequests: false,   // Don't record HTTP traces
  remoteLogLevel: 'error',      // Only send errors remotely
});
```

## Dependencies

This SDK includes:
- `@dex-monit/observability-contracts` - TypeScript interfaces
- `@dex-monit/observability-logger` - Pino-based logger
- `@dex-monit/observability-request-context` - Request context
- `@dex-monit/observability-scrubber` - Sensitive data scrubbing

## Peer Dependencies

```json
{
  "@nestjs/common": "^10.0.0 || ^11.0.0",
  "@nestjs/core": "^10.0.0 || ^11.0.0",
  "rxjs": "^7.0.0 || ^8.0.0",
  "uuid": "^9.0.0 - ^13.0.0"
}
```

## License

MIT
