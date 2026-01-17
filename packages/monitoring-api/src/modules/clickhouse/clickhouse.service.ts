import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  Logger as NestLogger,
} from '@nestjs/common';
import { createClient, ClickHouseClient } from '@clickhouse/client';
import { Logger } from '@dex-monit/observability-logger';

// Check if ClickHouse is enabled
const CLICKHOUSE_ENABLED = process.env['CLICKHOUSE_ENABLED'] === 'true';

@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private client: ClickHouseClient | null = null;
  private connected = false;
  private readonly nestLogger = new NestLogger('ClickHouseService');

  constructor(@Inject(Logger) private readonly logger: Logger) {}

  async onModuleInit() {
    if (!CLICKHOUSE_ENABLED) {
      this.nestLogger.warn(
        'ClickHouse disabled (set CLICKHOUSE_ENABLED=true to enable)',
      );
      return;
    }

    try {
      this.client = createClient({
        host: process.env['CLICKHOUSE_HOST'] || 'http://localhost:8123',
        username: process.env['CLICKHOUSE_USER'] || 'default',
        password: process.env['CLICKHOUSE_PASSWORD'] || '',
        database: process.env['CLICKHOUSE_DATABASE'] || 'dex_monitoring',
      });

      await this.initializeSchema();
      this.connected = true;
      this.logger.info('ClickHouse connected and schema initialized');
    } catch (error) {
      this.nestLogger.warn(
        `Failed to connect to ClickHouse: ${error instanceof Error ? error.message : error}`,
      );
      this.nestLogger.warn(
        'Continuing without ClickHouse (time-series storage disabled)',
      );
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close().catch(() => {});
    }
  }

  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  isEnabled(): boolean {
    return CLICKHOUSE_ENABLED;
  }

  getClient(): ClickHouseClient | null {
    return this.client;
  }

  /**
   * Initialize ClickHouse tables optimized for time-series data
   */
  private async initializeSchema() {
    if (!this.client) return;

    // Create database if not exists
    await this.client.command({
      query: `CREATE DATABASE IF NOT EXISTS dex_monitoring`,
    });

    // Events table - MergeTree optimized for time-series
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.events (
          id UUID DEFAULT generateUUIDv4(),
          project_id String,
          event_id String,
          timestamp DateTime64(3),
          received_at DateTime64(3) DEFAULT now64(3),
          
          -- Error details
          type String,
          value String,
          level LowCardinality(String),
          fingerprint String,
          
          -- Context
          environment LowCardinality(String),
          release String,
          server_name String,
          transaction String,
          
          -- User
          user_id String,
          user_email String,
          user_ip String,
          
          -- Request
          request_url String,
          request_method LowCardinality(String),
          
          -- Exception details (JSON)
          exception String,
          stacktrace String,
          breadcrumbs String,
          tags String,
          extra String,
          contexts String,
          
          -- SDK info
          sdk_name String,
          sdk_version String,
          
          -- Grouping
          issue_id String,
          
          INDEX idx_fingerprint fingerprint TYPE bloom_filter GRANULARITY 1,
          INDEX idx_level level TYPE set(10) GRANULARITY 1,
          INDEX idx_user_id user_id TYPE bloom_filter GRANULARITY 1
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (project_id, timestamp, fingerprint)
        TTL timestamp + INTERVAL 90 DAY
        SETTINGS index_granularity = 8192
      `,
    });

    // Logs table
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.logs (
          id UUID DEFAULT generateUUIDv4(),
          project_id String,
          timestamp DateTime64(3),
          received_at DateTime64(3) DEFAULT now64(3),
          
          level LowCardinality(String),
          message String,
          logger String,
          
          -- Context
          environment LowCardinality(String),
          service String,
          host String,
          
          -- Request context
          request_id String,
          transaction_id String,
          user_id String,
          
          -- Additional data (JSON)
          attributes String,
          
          INDEX idx_level level TYPE set(10) GRANULARITY 1,
          INDEX idx_request_id request_id TYPE bloom_filter GRANULARITY 1
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (project_id, timestamp, level)
        TTL timestamp + INTERVAL 30 DAY
        SETTINGS index_granularity = 8192
      `,
    });

    // HTTP Traces table
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.traces (
          id UUID DEFAULT generateUUIDv4(),
          project_id String,
          trace_id String,
          timestamp DateTime64(3),
          
          -- Request
          method LowCardinality(String),
          url String,
          path String,
          status_code UInt16,
          duration_ms UInt32,
          
          -- Client
          ip String,
          user_agent String,
          referer String,
          
          -- Size
          request_size UInt32,
          response_size UInt32,
          
          -- Context
          request_id String,
          transaction_id String,
          user_id String,
          environment LowCardinality(String),
          server_name String,
          
          -- Error
          error String,
          
          -- Headers & params (JSON)
          headers String,
          query_params String,
          
          INDEX idx_status status_code TYPE set(100) GRANULARITY 1,
          INDEX idx_method method TYPE set(10) GRANULARITY 1,
          INDEX idx_path path TYPE bloom_filter GRANULARITY 1
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (project_id, timestamp, path)
        TTL timestamp + INTERVAL 14 DAY
        SETTINGS index_granularity = 8192
      `,
    });

    // Issues aggregation table (materialized view)
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.issues (
          id String,
          project_id String,
          short_id String,
          fingerprint String,
          
          title String,
          culprit String,
          type String,
          level LowCardinality(String),
          status LowCardinality(String) DEFAULT 'UNRESOLVED',
          platform LowCardinality(String) DEFAULT 'node',
          
          first_seen DateTime64(3),
          last_seen DateTime64(3),
          
          event_count UInt64,
          user_count UInt64,
          
          environments Array(String),
          releases Array(String),
          
          -- Sample data
          sample_event_id String,
          sample_stacktrace String,
          
          updated_at DateTime64(3) DEFAULT now64(3)
        )
        ENGINE = ReplacingMergeTree(updated_at)
        ORDER BY (project_id, fingerprint)
      `,
    });

    // Add platform column if not exists (migration for existing tables)
    await this.client
      .command({
        query: `ALTER TABLE dex_monitoring.issues ADD COLUMN IF NOT EXISTS platform LowCardinality(String) DEFAULT 'node'`,
      })
      .catch(() => {});

    // Sessions table - track user sessions
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.sessions (
          id UUID DEFAULT generateUUIDv4(),
          project_id String,
          session_id String,
          user_id String,
          
          -- Session info
          started_at DateTime64(3),
          ended_at DateTime64(3),
          last_activity DateTime64(3),
          duration_ms UInt64 DEFAULT 0,
          is_active UInt8 DEFAULT 1,
          
          -- Device/Client info
          platform LowCardinality(String),
          device_type LowCardinality(String),
          device_brand String DEFAULT '',
          device_model String DEFAULT '',
          os_name String,
          os_version String,
          app_version String,
          browser String,
          browser_version String,
          
          -- Location (from IP)
          ip String,
          country LowCardinality(String),
          city String,
          
          -- Metrics
          page_views UInt32 DEFAULT 0,
          events_count UInt32 DEFAULT 0,
          errors_count UInt32 DEFAULT 0,
          
          -- Entry/Exit
          entry_page String,
          exit_page String,
          
          -- UTM/Referrer
          referrer String,
          utm_source String,
          utm_medium String,
          utm_campaign String,
          
          INDEX idx_user user_id TYPE bloom_filter GRANULARITY 1,
          INDEX idx_platform platform TYPE set(10) GRANULARITY 1
        )
        ENGINE = ReplacingMergeTree(last_activity)
        PARTITION BY toYYYYMM(started_at)
        ORDER BY (project_id, session_id)
        TTL started_at + INTERVAL 90 DAY
      `,
    });

    // Page views / Screen views table
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.page_views (
          id UUID DEFAULT generateUUIDv4(),
          project_id String,
          session_id String,
          user_id String,
          
          -- View info
          timestamp DateTime64(3),
          page_url String,
          page_path String,
          page_title String,
          screen_name String,
          
          -- Performance
          load_time_ms UInt32,
          dom_ready_ms UInt32,
          
          -- Interaction
          time_on_page_ms UInt32 DEFAULT 0,
          scroll_depth UInt8 DEFAULT 0,
          interactions UInt32 DEFAULT 0,
          
          -- Context
          referrer String,
          previous_page String,
          
          -- Device
          viewport_width UInt16,
          viewport_height UInt16,
          
          INDEX idx_session session_id TYPE bloom_filter GRANULARITY 1,
          INDEX idx_path page_path TYPE bloom_filter GRANULARITY 1
        )
        ENGINE = MergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (project_id, timestamp, session_id)
        TTL timestamp + INTERVAL 30 DAY
      `,
    });

    // User activity heartbeats (for real-time active users)
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.user_activity (
          project_id String,
          user_id String,
          session_id String,
          timestamp DateTime64(3),
          activity_type LowCardinality(String),
          page_path String,
          
          INDEX idx_user user_id TYPE bloom_filter GRANULARITY 1
        )
        ENGINE = MergeTree()
        PARTITION BY toDate(timestamp)
        ORDER BY (project_id, timestamp)
        TTL timestamp + INTERVAL 7 DAY
      `,
    });

    // Metrics aggregation (per minute)
    await this.client.command({
      query: `
        CREATE TABLE IF NOT EXISTS dex_monitoring.metrics_1m (
          project_id String,
          timestamp DateTime,
          
          -- Error metrics
          error_count UInt64,
          warning_count UInt64,
          
          -- HTTP metrics
          request_count UInt64,
          avg_duration_ms Float64,
          p50_duration_ms Float64,
          p95_duration_ms Float64,
          p99_duration_ms Float64,
          error_rate Float64,
          
          -- Log metrics
          log_count UInt64,
          
          -- By status
          status_2xx UInt64,
          status_3xx UInt64,
          status_4xx UInt64,
          status_5xx UInt64
        )
        ENGINE = SummingMergeTree()
        PARTITION BY toYYYYMM(timestamp)
        ORDER BY (project_id, timestamp)
        TTL timestamp + INTERVAL 365 DAY
      `,
    });

    this.logger.info('ClickHouse schema initialized');
  }

  /**
   * Execute a query and return results
   */
  async query<T>(
    query: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    if (!this.client) return [];
    try {
      // Process query params to convert timestamps
      const processedParams = params
        ? this.processQueryParams(params)
        : undefined;

      const result = await this.client.query({
        query,
        query_params: processedParams,
        format: 'JSONEachRow',
      });
      return result.json<T>();
    } catch (error) {
      this.nestLogger.error(
        `ClickHouse query failed: ${error instanceof Error ? error.message : error}`,
      );
      return [];
    }
  }

  /**
   * Process query parameters (convert ISO timestamps to ClickHouse format)
   */
  private processQueryParams(
    params: Record<string, unknown>,
  ): Record<string, unknown> {
    const processed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      // Check if value looks like an ISO timestamp
      if (
        typeof value === 'string' &&
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
      ) {
        processed[key] = this.formatTimestamp(value);
      } else if (value instanceof Date) {
        processed[key] = this.formatTimestamp(value);
      } else {
        processed[key] = value;
      }
    }
    return processed;
  }

  /**
   * Convert ISO timestamp to ClickHouse format
   */
  private formatTimestamp(value: unknown): string {
    if (!value)
      return new Date().toISOString().replace('T', ' ').replace('Z', '');
    if (typeof value === 'string') {
      // Convert ISO format to ClickHouse format: "2026-01-16T01:49:19.000Z" -> "2026-01-16 01:49:19.000"
      return value.replace('T', ' ').replace('Z', '');
    }
    if (value instanceof Date) {
      return value.toISOString().replace('T', ' ').replace('Z', '');
    }
    return String(value);
  }

  /**
   * Process values for ClickHouse (convert timestamps, etc.)
   */
  private processValues<T extends Record<string, unknown>>(values: T[]): T[] {
    // All possible timestamp field names used across tables
    const timestampFields = [
      'timestamp',
      'received_at',
      'created_at',
      'updated_at',
      'first_seen',
      'last_seen',
      'started_at',
      'ended_at',
      'last_activity',
    ];

    return values.map((row) => {
      const processed: Record<string, unknown> = { ...row };
      for (const field of timestampFields) {
        if (field in processed && processed[field]) {
          processed[field] = this.formatTimestamp(processed[field]);
        }
      }
      return processed as T;
    });
  }

  /**
   * Insert data into a table
   */
  async insert<T extends Record<string, unknown>>(
    table: string,
    values: T[],
  ): Promise<void> {
    if (!this.client || values.length === 0) return;
    try {
      const processedValues = this.processValues(values);
      await this.client.insert({
        table: `dex_monitoring.${table}`,
        values: processedValues,
        format: 'JSONEachRow',
      });
    } catch (error) {
      this.nestLogger.error(
        `ClickHouse insert failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * Execute a command (DDL, etc.)
   */
  async command(query: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.command({ query });
    } catch (error) {
      this.nestLogger.error(
        `ClickHouse command failed: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
