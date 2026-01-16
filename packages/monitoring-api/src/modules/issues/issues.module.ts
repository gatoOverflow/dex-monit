import { Module } from '@nestjs/common';
import { IssuesController } from './issues.controller.js';
import { IssuesService } from './issues.service.js';
import { IssuesClickHouseService } from './issues-clickhouse.service.js';
import { EventsModule } from '../events/events.module.js';

@Module({
  imports: [EventsModule],
  controllers: [IssuesController],
  providers: [IssuesService, IssuesClickHouseService],
  exports: [IssuesService, IssuesClickHouseService],
})
export class IssuesModule {}
