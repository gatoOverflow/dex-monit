import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { DatabaseModule } from '../database/database.module.js';
import { ClickHouseModule } from '../clickhouse/clickhouse.module.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [DatabaseModule, ClickHouseModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
