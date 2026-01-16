import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from './projects.service.js';
import { ApiKeysController } from './api-keys.controller.js';
import { ApiKeysService } from './api-keys.service.js';

@Module({
  controllers: [ProjectsController, ApiKeysController],
  providers: [ProjectsService, ApiKeysService],
  exports: [ProjectsService, ApiKeysService],
})
export class ProjectsModule {}
