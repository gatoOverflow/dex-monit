import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { DatabaseModule } from '../database/database.module.js';
import { ClickhouseModule } from '../clickhouse/clickhouse.module.js';
import { RedisModule } from '../redis/redis.module.js';

@Module({
  imports: [DatabaseModule, ClickhouseModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
