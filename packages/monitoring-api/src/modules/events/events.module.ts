import { Module } from '@nestjs/common';
import { EventsController, IssueEventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { EventsClickHouseService } from './events-clickhouse.service.js';
import { IssueGroupingService } from './issue-grouping.service.js';

@Module({
  controllers: [EventsController, IssueEventsController],
  providers: [EventsService, EventsClickHouseService, IssueGroupingService],
  exports: [EventsService, EventsClickHouseService, IssueGroupingService],
})
export class EventsModule {}
