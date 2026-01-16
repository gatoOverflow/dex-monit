import { Module } from '@nestjs/common';
import { ReleasesController } from './releases.controller.js';
import { ReleasesService } from './releases.service.js';
import { SourceMapsService } from './source-maps.service.js';

@Module({
  controllers: [ReleasesController],
  providers: [ReleasesService, SourceMapsService],
  exports: [ReleasesService, SourceMapsService],
})
export class ReleasesModule {}
