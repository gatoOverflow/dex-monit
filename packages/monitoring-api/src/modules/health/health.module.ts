import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { DatabaseModule } from '../database/database.module.js';

// Import services directly instead of modules to avoid undefined issues
import { ClickHouseService } from '../clickhouse/clickhouse.service.js';
import { RedisService } from '../redis/redis.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
  providers: [ClickHouseService, RedisService],
})
export class HealthModule {}
