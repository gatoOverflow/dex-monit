import { AsyncLocalStorage } from 'async_hooks';

/**
 * Context data stored in AsyncLocalStorage
 */
export interface RequestContextData {
  /** Unique request identifier */
  requestId: string;
  /** Transaction ID for distributed tracing */
  transactionId?: string;
  /** User ID if authenticated */
  userId?: string;
  /** Request start time */
  startTime: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * AsyncLocalStorage-based Request Context Service
 * Provides request-scoped context without explicit passing
 */
class RequestContextServiceImpl {
  private storage = new AsyncLocalStorage<RequestContextData>();

  /**
   * Run a function within a request context
   * @param context - The context data for this request
   * @param fn - The function to run within the context
   * @returns The result of the function
   */
  run<T>(context: RequestContextData, fn: () => T): T {
    return this.storage.run(context, fn);
  }

  /**
   * Run an async function within a request context
   * @param context - The context data for this request
   * @param fn - The async function to run within the context
   * @returns Promise of the function result
   */
  runAsync<T>(context: RequestContextData, fn: () => Promise<T>): Promise<T> {
    return this.storage.run(context, fn);
  }

  /**
   * Get the current request context
   * @returns The current context or undefined if not in a context
   */
  get(): RequestContextData | undefined {
    return this.storage.getStore();
  }

  /**
   * Get the current request context or throw if not available
   * @throws Error if not within a request context
   * @returns The current context
   */
  getOrThrow(): RequestContextData {
    const context = this.get();
    if (!context) {
      throw new Error(
        'RequestContext not available. Ensure you are within a request context.',
      );
    }
    return context;
  }

  /**
   * Get the current request ID
   * @returns The request ID or undefined
   */
  getRequestId(): string | undefined {
    return this.get()?.requestId;
  }

  /**
   * Get the current transaction ID
   * @returns The transaction ID or undefined
   */
  getTransactionId(): string | undefined {
    return this.get()?.transactionId;
  }

  /**
   * Get the current user ID
   * @returns The user ID or undefined
   */
  getUserId(): string | undefined {
    return this.get()?.userId;
  }

  /**
   * Update the current context with additional data
   * Note: This creates a shallow merge with existing context
   * @param updates - Partial context data to merge
   */
  update(updates: Partial<RequestContextData>): void {
    const current = this.get();
    if (current) {
      Object.assign(current, updates);
    }
  }

  /**
   * Set metadata on the current context
   * @param key - Metadata key
   * @param value - Metadata value
   */
  setMetadata(key: string, value: unknown): void {
    const current = this.get();
    if (current) {
      current.metadata = current.metadata || {};
      current.metadata[key] = value;
    }
  }

  /**
   * Get metadata from the current context
   * @param key - Metadata key
   * @returns The metadata value or undefined
   */
  getMetadata<T = unknown>(key: string): T | undefined {
    return this.get()?.metadata?.[key] as T | undefined;
  }
}

/**
 * Singleton instance of RequestContextService
 */
export const RequestContextService = new RequestContextServiceImpl();

/**
 * Export the type for the service
 */
export type RequestContextService = RequestContextServiceImpl;
