# @dex-monit/observability-request-context

AsyncLocalStorage-based request context for Node.js applications. Provides request-scoped context without explicit parameter passing.

## Installation

```bash
npm install @dex-monit/observability-request-context
```

## Requirements

- Node.js >= 16.0.0

## Overview

This package provides a singleton `RequestContextService` that uses Node.js `AsyncLocalStorage` to maintain request-scoped data throughout the entire request lifecycle, including across async operations.

## Features

- ✅ Request-scoped context without manual parameter passing
- ✅ Works across async/await and callbacks
- ✅ Automatic propagation through the call stack
- ✅ Type-safe with TypeScript
- ✅ Zero dependencies (uses Node.js built-in `async_hooks`)

## Usage

### Basic Usage

```typescript
import { RequestContextService } from '@dex-monit/observability-request-context';

// Start a context
RequestContextService.run(
  {
    requestId: 'req-123',
    transactionId: 'tx-456',
    startTime: Date.now(),
  },
  () => {
    // Access context anywhere in the call stack
    console.log(RequestContextService.getRequestId()); // 'req-123'
    
    // Call nested functions - context is available
    processRequest();
  }
);

function processRequest() {
  // Context is automatically available
  const ctx = RequestContextService.get();
  console.log(ctx?.requestId); // 'req-123'
}
```

### With Express/NestJS

```typescript
import { RequestContextService } from '@dex-monit/observability-request-context';
import { v4 as uuid } from 'uuid';

// Express middleware
app.use((req, res, next) => {
  RequestContextService.run(
    {
      requestId: req.headers['x-request-id'] || uuid(),
      transactionId: req.headers['x-transaction-id'],
      startTime: Date.now(),
    },
    () => next()
  );
});
```

### Async Operations

```typescript
import { RequestContextService } from '@dex-monit/observability-request-context';

RequestContextService.run(
  { requestId: 'req-123', startTime: Date.now() },
  async () => {
    // Context persists across async operations
    await someAsyncOperation();
    
    // Still available
    console.log(RequestContextService.getRequestId()); // 'req-123'
  }
);
```

## API Reference

### RequestContextData

```typescript
interface RequestContextData {
  requestId: string;
  transactionId?: string;
  userId?: string;
  startTime: number;
  metadata?: Record<string, unknown>;
}
```

### RequestContextService Methods

#### `run<T>(context: RequestContextData, fn: () => T): T`
Execute a function within a request context (synchronous).

```typescript
const result = RequestContextService.run(
  { requestId: 'req-123', startTime: Date.now() },
  () => doSomething()
);
```

#### `runAsync<T>(context: RequestContextData, fn: () => Promise<T>): Promise<T>`
Execute an async function within a request context.

```typescript
const result = await RequestContextService.runAsync(
  { requestId: 'req-123', startTime: Date.now() },
  async () => await doAsyncSomething()
);
```

#### `get(): RequestContextData | undefined`
Get the current context (returns `undefined` if not in a context).

```typescript
const ctx = RequestContextService.get();
if (ctx) {
  console.log(ctx.requestId);
}
```

#### `getOrThrow(): RequestContextData`
Get the current context or throw if not available.

```typescript
try {
  const ctx = RequestContextService.getOrThrow();
  console.log(ctx.requestId);
} catch (error) {
  console.error('Not in a request context');
}
```

#### `getRequestId(): string | undefined`
Shorthand to get the current request ID.

```typescript
const requestId = RequestContextService.getRequestId();
```

#### `getTransactionId(): string | undefined`
Shorthand to get the current transaction ID.

```typescript
const transactionId = RequestContextService.getTransactionId();
```

#### `getUserId(): string | undefined`
Shorthand to get the current user ID.

```typescript
const userId = RequestContextService.getUserId();
```

#### `update(updates: Partial<RequestContextData>): void`
Update the current context with additional data.

```typescript
RequestContextService.update({ userId: 'user-123' });
```

#### `setMetadata(key: string, value: unknown): void`
Set a metadata value on the current context.

```typescript
RequestContextService.setMetadata('tenantId', 'tenant-456');
```

#### `getMetadata<T>(key: string): T | undefined`
Get a metadata value from the current context.

```typescript
const tenantId = RequestContextService.getMetadata<string>('tenantId');
```

## Integration with Logger

```typescript
import { RequestContextService } from '@dex-monit/observability-request-context';
import pino from 'pino';

const logger = pino({
  mixin() {
    const ctx = RequestContextService.get();
    return ctx ? {
      requestId: ctx.requestId,
      transactionId: ctx.transactionId,
      userId: ctx.userId,
    } : {};
  },
});

// Logs automatically include request context
logger.info('Processing request'); 
// Output: {"requestId":"req-123","transactionId":"tx-456","msg":"Processing request"}
```

## How It Works

This package uses Node.js `AsyncLocalStorage` from the `async_hooks` module. AsyncLocalStorage creates a storage that is available throughout the lifetime of an async operation, automatically propagating through:

- Promise chains
- async/await calls
- setTimeout/setInterval callbacks
- EventEmitter listeners
- And more...

## License

MIT
