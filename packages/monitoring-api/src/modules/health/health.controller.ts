import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';

interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
  services: {
    postgres: { status: 'ok' | 'error'; latency?: number };
    clickhouse: { status: 'ok' | 'error' | 'disabled'; latency?: number };
    redis: { status: 'ok' | 'error' | 'disabled'; latency?: number };
  };
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clickhouse: ClickHouseService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async check(): Promise<HealthStatus> {
    const services: HealthStatus['services'] = {
      postgres: { status: 'error' },
      clickhouse: { status: 'disabled' },
      redis: { status: 'disabled' },
    };

    // Check PostgreSQL
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      services.postgres = { status: 'ok', latency: Date.now() - start };
    } catch {
      services.postgres = { status: 'error' };
    }

    // Check ClickHouse
    if (this.clickhouse.isEnabled()) {
      try {
        const start = Date.now();
        await this.clickhouse.query('SELECT 1');
        services.clickhouse = { status: 'ok', latency: Date.now() - start };
      } catch {
        services.clickhouse = { status: 'error' };
      }
    }

    // Check Redis
    if (this.redis.isEnabled()) {
      try {
        const start = Date.now();
        await this.redis.get('health-check');
        services.redis = { status: 'ok', latency: Date.now() - start };
      } catch {
        services.redis = { status: 'error' };
      }
    }

    // Determine overall status
    const hasError = services.postgres.status === 'error';
    const hasDegraded = 
      services.clickhouse.status === 'error' || 
      services.redis.status === 'error';

    return {
      status: hasError ? 'error' : hasDegraded ? 'degraded' : 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      services,
    };
  }

  @Get('ready')
  async ready(): Promise<{ ready: boolean }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { ready: true };
    } catch {
      return { ready: false };
    }
  }

  @Get('live')
  live(): { live: boolean } {
    return { live: true };
  }
}
