import { Module } from '@nestjs/common';
import { SdkNodeModule } from '@dex-monit/observability-sdk-node';

// Core modules
import { DatabaseModule } from '../modules/database/index.js';
import { UsersModule } from '../modules/users/index.js';
import { TeamsModule } from '../modules/teams/index.js';
import { ProjectsModule } from '../modules/projects/index.js';

// High-performance data stores
import { ClickHouseModule } from '../modules/clickhouse/index.js';
import { RedisModule } from '../modules/redis/index.js';
import { QueueModule } from '../modules/queue/index.js';

// Feature modules
import { EventsModule } from '../modules/events/index.js';
import { IssuesModule } from '../modules/issues/index.js';
import { LogsModule } from '../modules/logs/index.js';
import { IngestModule } from '../modules/ingest/index.js';
import { AlertsModule } from '../modules/alerts/index.js';
import { ReleasesModule } from '../modules/releases/index.js';
import { TracesModule } from '../modules/traces/traces.module.js';
import { SettingsModule } from '../modules/settings/index.js';
import { SessionsModule } from '../modules/sessions/index.js';
import { HealthModule } from '../modules/health/health.module.js';

@Module({
  imports: [
    // Observability SDK - provides logging, request tracing, and error capture
    SdkNodeModule.forRoot({
      logger: {
        name: 'monitoring-api',
        level: process.env['LOG_LEVEL'] === 'debug' ? 'debug' : 'info',
        environment: process.env['NODE_ENV'] || 'development',
        prettyPrint: process.env['NODE_ENV'] !== 'production',
      },
      // Note: In production, configure monitoring to point to the ingestion endpoint
      // monitoring: {
      //   apiUrl: process.env['MONITORING_API_URL'] || 'http://localhost:3000/api',
      //   project: 'monitoring-api',
      //   environment: process.env['NODE_ENV'] || 'development',
      // },
    }),

    // Core infrastructure
    DatabaseModule,
    
    // High-performance data stores (ClickHouse + Redis)
    // Note: Set REDIS_ENABLED=true to enable Redis/caching
    // Set ASYNC_INGESTION=true to enable async queue ingestion
    ClickHouseModule,
    RedisModule,
    QueueModule.forRoot(),
    
    // Authentication & Authorization
    UsersModule,
    TeamsModule,
    ProjectsModule,

    // Error Monitoring
    EventsModule,
    IssuesModule,
    IngestModule,
    AlertsModule,
    ReleasesModule,

    // Log Management
    LogsModule,

    // Performance Monitoring
    TracesModule,

    // Settings & Integrations
    SettingsModule,

    // User Analytics
    SessionsModule,

    // Health & Monitoring
    HealthModule,
  ],
})
export class AppModule {}
