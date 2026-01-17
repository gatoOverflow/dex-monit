import { Module } from '@nestjs/common';
import { SessionsController } from './sessions.controller.js';
import { SessionsClickHouseService } from './sessions-clickhouse.service.js';
import { ProjectsModule } from '../projects/projects.module.js';

@Module({
  imports: [ProjectsModule],
  controllers: [SessionsController],
  providers: [SessionsClickHouseService],
  exports: [SessionsClickHouseService],
})
export class SessionsModule {}
