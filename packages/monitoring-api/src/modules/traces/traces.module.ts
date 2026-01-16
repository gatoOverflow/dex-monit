import { Module } from '@nestjs/common';
import { TracesController } from './traces.controller.js';
import { TracesService } from './traces.service.js';
import { TracesClickHouseService } from './traces-clickhouse.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { ProjectsModule } from '../projects/index.js';

@Module({
  imports: [DatabaseModule, ProjectsModule],
  controllers: [TracesController],
  providers: [TracesService, TracesClickHouseService],
  exports: [TracesService, TracesClickHouseService],
})
export class TracesModule {}
