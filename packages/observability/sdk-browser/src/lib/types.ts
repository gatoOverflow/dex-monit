// Local type definitions to avoid build issues with external packages

export type Severity = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

export interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  context?: string[];
}

export interface Breadcrumb {
  timestamp: string;
  category?: string;
  message?: string;
  level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal';
  data?: Record<string, unknown>;
  type?: string;
}

export interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: StackFrame[];
}

export interface UserContext {
  id?: string;
  email?: string;
  username?: string;
  [key: string]: unknown;
}

export interface EventContext {
  user?: {
    id?: string;
    email?: string;
    username?: string;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

export interface RequestContext {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  data?: unknown;
}

export interface ErrorEvent {
  eventId: string;
  timestamp: string;
  platform: string;
  level: Severity;
  message?: string;
  exception?: ExceptionValue;
  tags?: Record<string, string>;
  breadcrumbs?: Breadcrumb[];
  contexts?: EventContext;
  environment?: string;
  release?: string;
  request?: RequestContext;
  user?: UserContext;
  fingerprint?: string[];
  sessionId?: string;
}

export interface LogEvent {
  timestamp: string;
  level: string;
  message: string;
  context?: Record<string, unknown>;
  tags?: Record<string, string>;
  environment?: string;
  release?: string;
  sessionId?: string;
}
