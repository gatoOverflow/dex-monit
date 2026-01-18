# @dex-monit/observability-contracts

TypeScript contracts and interfaces for the Dex Monitoring platform.

## Installation

```bash
npm install @dex-monit/observability-contracts
```

## Overview

This package provides all the TypeScript interfaces and types used by the Dex Monitoring SDKs and platform. It ensures type safety and consistency across all integrations.

## Interfaces

### Core Types

#### Severity
```typescript
type Severity = 'debug' | 'info' | 'warning' | 'error' | 'fatal';
```

#### IssueStatus
```typescript
type IssueStatus = 'unresolved' | 'resolved' | 'ignored' | 'archived';
```

### Error Events

#### ErrorEvent
The main structure for reporting errors to the monitoring platform.

```typescript
interface ErrorEvent {
  eventId: string;           // Unique event identifier
  timestamp: string;         // ISO 8601 timestamp
  level: Severity;           // Error severity
  platform: string;          // 'node', 'browser', 'react-native'
  sdk: { name: string; version: string };
  project: string;           // Project identifier
  environment: string;       // 'production', 'staging', 'development'
  serverName?: string;
  release?: string;
  message: string;           // Error message
  exception?: ExceptionDetails;
  breadcrumbs?: Breadcrumb[];
  requestId?: string;
  transactionId?: string;
  contexts?: EventContext;
  fingerprint?: string[];
}
```

#### ExceptionDetails
```typescript
interface ExceptionDetails {
  type: string;              // Error type (e.g., 'TypeError')
  value: string;             // Error message
  stacktrace?: StackFrame[];
}
```

#### StackFrame
```typescript
interface StackFrame {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  context?: string[];        // Source code context
}
```

### Log Events

#### LogEvent
```typescript
interface LogEvent {
  id: string;
  timestamp: string;
  level: Severity;
  message: string;
  project: string;
  environment: string;
  serverName?: string;
  requestId?: string;
  transactionId?: string;
  data?: Record<string, unknown>;
  tags?: Record<string, string>;
}
```

### Context Interfaces

#### EventContext
```typescript
interface EventContext {
  client?: ClientContext;    // Browser info
  runtime?: RuntimeContext;  // Node.js version, etc.
  os?: OSContext;            // Operating system
  device?: DeviceContext;    // Server/device info
  app?: AppContext;          // Application metrics
  request?: RequestContext;  // HTTP request details
  user?: UserContext;        // User information
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}
```

#### UserContext
```typescript
interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  ipAddress?: string;
}
```

#### RequestContext
```typescript
interface RequestContext {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
  data?: Record<string, unknown>;
}
```

### Issues

#### Issue
```typescript
interface Issue {
  id: string;
  shortId: string;           // Human-readable ID (e.g., 'PROJ-123')
  title: string;
  culprit?: string;          // Error origin
  project: string;
  status: IssueStatus;
  level: Severity;
  firstSeen: string;
  lastSeen: string;
  count: number;             // Total events
  userCount: number;         // Affected users
  platform: string;
  fingerprint: string[];
  metadata?: { type?: string; value?: string; filename?: string; function?: string };
  assignedTo?: string;
  tags?: Record<string, string>;
}
```

### API Types

#### PaginatedResponse
```typescript
interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

#### ApiResponse
```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}
```

### Query Parameters

#### ListIssuesQuery
```typescript
interface ListIssuesQuery {
  project?: string;
  status?: IssueStatus;
  level?: Severity;
  page?: number;
  pageSize?: number;
  sortBy?: 'lastSeen' | 'firstSeen' | 'count' | 'userCount';
  sortOrder?: 'asc' | 'desc';
}
```

#### ListLogsQuery
```typescript
interface ListLogsQuery {
  project?: string;
  level?: Severity;
  requestId?: string;
  transactionId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}
```

## Usage Example

```typescript
import type { 
  ErrorEvent, 
  LogEvent, 
  Severity,
  UserContext 
} from '@dex-monit/observability-contracts';

// Type-safe error event
const errorEvent: ErrorEvent = {
  eventId: 'abc123',
  timestamp: new Date().toISOString(),
  level: 'error',
  platform: 'node',
  sdk: { name: 'sdk-node', version: '1.0.0' },
  project: 'my-project',
  environment: 'production',
  message: 'Something went wrong',
  contexts: {
    user: {
      id: 'user-123',
      email: 'user@example.com',
    } as UserContext,
  },
};
```

## License

MIT
