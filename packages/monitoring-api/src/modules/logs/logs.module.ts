import { Module } from '@nestjs/common';
import { LogsController } from './logs.controller.js';
import { LogsService } from './logs.service.js';
import { LogsClickHouseService } from './logs-clickhouse.service.js';

@Module({
  controllers: [LogsController],
  providers: [LogsService, LogsClickHouseService],
  exports: [LogsService, LogsClickHouseService],
})
export class LogsModule {}
