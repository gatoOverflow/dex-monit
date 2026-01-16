import { Module } from '@nestjs/common';
import { IngestController } from './ingest.controller.js';
import { IngestService } from './ingest.service.js';
import { EventsModule } from '../events/events.module.js';
import { LogsModule } from '../logs/logs.module.js';
import { TracesModule } from '../traces/traces.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { AlertsModule } from '../alerts/alerts.module.js';

@Module({
  imports: [
    EventsModule,
    LogsModule,
    TracesModule,
    ProjectsModule,
    AlertsModule,
  ],
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
