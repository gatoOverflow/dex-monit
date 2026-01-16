/**
 * Contracts for the Observability Platform
 * Defines the core data structures for error monitoring and log management
 */

/**
 * Severity levels for errors and logs
 */
export type Severity = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/**
 * Stack frame information for error traces
 */
export interface StackFrame {
  filename: string;
  function: string;
  lineno: number;
  colno: number;
  context?: string[];
}

/**
 * Exception details captured from errors
 */
export interface ExceptionDetails {
  type: string;
  value: string;
  stacktrace?: StackFrame[];
}

/**
 * Browser/Client information
 */
export interface ClientContext {
  name?: string;
  version?: string;
  userAgent?: string;
}

/**
 * Runtime information
 */
export interface RuntimeContext {
  name: string;
  version: string;
}

/**
 * Operating system information
 */
export interface OSContext {
  name?: string;
  version?: string;
  kernelVersion?: string;
}

/**
 * Device/Server information
 */
export interface DeviceContext {
  arch?: string;
  memory?: number;
  cpus?: number;
  hostname?: string;
  bootTime?: string;
}

/**
 * Application context
 */
export interface AppContext {
  startTime?: number;
  memoryUsage?: {
    heapUsed?: number;
    heapTotal?: number;
    rss?: number;
    external?: number;
  };
}

/**
 * Request context captured during error
 */
export interface RequestContext {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  cookies?: Record<string, string>;
  data?: Record<string, unknown>;
}

/**
 * User information
 */
export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  ipAddress?: string;
}

/**
 * Context information attached to events
 */
export interface EventContext {
  client?: ClientContext;
  runtime?: RuntimeContext;
  os?: OSContext;
  device?: DeviceContext;
  app?: AppContext;
  request?: RequestContext;
  user?: UserContext;
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/**
 * Error event sent to the monitoring platform
 */
export interface ErrorEvent {
  /** Unique identifier for the event */
  eventId: string;
  /** Timestamp when error occurred (ISO 8601) */
  timestamp: string;
  /** Severity level */
  level: Severity;
  /** Platform identifier (e.g., 'node', 'browser') */
  platform: string;
  /** SDK information */
  sdk: {
    name: string;
    version: string;
  };
  /** Service/project identifier */
  project: string;
  /** Environment (e.g., 'production', 'staging') */
  environment: string;
  /** Server name / hostname */
  serverName?: string;
  /** Release/version identifier */
  release?: string;
  /** Error message */
  message: string;
  /** Exception details */
  exception?: ExceptionDetails;
  /** Breadcrumbs leading up to the error */
  breadcrumbs?: Breadcrumb[];
  /** Request ID for correlation */
  requestId?: string;
  /** Transaction ID for distributed tracing */
  transactionId?: string;
  /** Additional context */
  contexts?: EventContext;
  /** Fingerprint for grouping */
  fingerprint?: string[];
}

/**
 * Breadcrumb for tracking events leading up to an error
 */
export interface Breadcrumb {
  timestamp: string;
  category: string;
  message?: string;
  level?: Severity;
  type?: 'default' | 'http' | 'navigation' | 'error' | 'debug' | 'query';
  data?: Record<string, unknown>;
}

/**
 * Log event sent to the monitoring platform
 */
export interface LogEvent {
  /** Unique identifier for the log entry */
  id: string;
  /** Timestamp when log was created (ISO 8601) */
  timestamp: string;
  /** Log level */
  level: Severity;
  /** Log message */
  message: string;
  /** Service/project identifier */
  project: string;
  /** Environment (e.g., 'production', 'staging') */
  environment: string;
  /** Server name / hostname */
  serverName?: string;
  /** Request ID for correlation */
  requestId?: string;
  /** Transaction ID for distributed tracing */
  transactionId?: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Tags for filtering */
  tags?: Record<string, string>;
}

/**
 * Issue status
 */
export type IssueStatus = 'unresolved' | 'resolved' | 'ignored' | 'archived';

/**
 * Issue representing a grouped set of similar errors
 */
export interface Issue {
  /** Unique identifier for the issue */
  id: string;
  /** Short identifier for display */
  shortId: string;
  /** Issue title (typically the error message or type) */
  title: string;
  /** Error culprit (file/function where error originated) */
  culprit?: string;
  /** Project identifier */
  project: string;
  /** Issue status */
  status: IssueStatus;
  /** Severity level */
  level: Severity;
  /** First time this issue was seen (ISO 8601) */
  firstSeen: string;
  /** Last time this issue was seen (ISO 8601) */
  lastSeen: string;
  /** Total number of events for this issue */
  count: number;
  /** Number of affected users */
  userCount: number;
  /** Platform where issue occurred */
  platform: string;
  /** Fingerprint used for grouping */
  fingerprint: string[];
  /** Metadata about the issue */
  metadata?: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
  /** Assignee user ID */
  assignedTo?: string;
  /** Tags associated with the issue */
  tags?: Record<string, string>;
}

/**
 * Pagination metadata for list responses
 */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Paginated response wrapper
 */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Query parameters for listing issues
 */
export interface ListIssuesQuery {
  project?: string;
  status?: IssueStatus;
  level?: Severity;
  page?: number;
  pageSize?: number;
  sortBy?: 'lastSeen' | 'firstSeen' | 'count' | 'userCount';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Query parameters for listing logs
 */
export interface ListLogsQuery {
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
