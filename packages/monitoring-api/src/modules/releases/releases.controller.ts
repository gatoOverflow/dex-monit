import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReleasesService, CreateReleaseDto } from './releases.service.js';
import { SourceMapsService } from './source-maps.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';
import type { Release, SourceMap } from '@prisma/client';

@Controller('projects/:projectId/releases')
@UseGuards(AuthGuard('jwt'))
export class ReleasesController {
  constructor(
    private readonly releasesService: ReleasesService,
    private readonly sourceMapsService: SourceMapsService
  ) {}

  /**
   * POST /projects/:projectId/releases
   * Create a new release
   */
  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() data: Omit<CreateReleaseDto, 'projectId'>
  ): Promise<ApiResponse<Release>> {
    const release = await this.releasesService.create({
      ...data,
      projectId,
    });
    return { success: true, data: release };
  }

  /**
   * GET /projects/:projectId/releases
   * List releases for a project
   */
  @Get()
  async list(
    @Param('projectId') projectId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ): Promise<ApiResponse<PaginatedResponse<Release>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '20', 10);

    const { data, total } = await this.releasesService.findByProject(projectId, {
      skip: (pageNum - 1) * size,
      take: size,
    });

    return {
      success: true,
      data: {
        data,
        meta: {
          page: pageNum,
          pageSize: size,
          total,
          totalPages: Math.ceil(total / size),
        },
      },
    };
  }

  /**
   * GET /projects/:projectId/releases/:id
   * Get a release
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<Release | null>> {
    const release = await this.releasesService.findById(id);
    return { success: true, data: release };
  }

  /**
   * GET /projects/:projectId/releases/:id/stats
   * Get release statistics
   */
  @Get(':id/stats')
  async getStats(@Param('id') id: string): Promise<ApiResponse<{
    eventCount: number;
    issueCount: number;
    newIssues: number;
  }>> {
    const stats = await this.releasesService.getStats(id);
    return { success: true, data: stats };
  }

  /**
   * DELETE /projects/:projectId/releases/:id
   * Delete a release
   */
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<ApiResponse<{ message: string }>> {
    await this.releasesService.delete(id);
    return { success: true, data: { message: 'Release deleted' } };
  }

  /**
   * POST /projects/:projectId/releases/:id/sourcemaps
   * Upload a source map
   */
  @Post(':id/sourcemaps')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSourceMap(
    @Param('projectId') projectId: string,
    @Param('id') releaseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { filename: string }
  ): Promise<ApiResponse<SourceMap>> {
    const sourceMap = await this.sourceMapsService.upload({
      projectId,
      releaseId,
      filename: body.filename || file.originalname,
      content: file.buffer,
    });
    return { success: true, data: sourceMap };
  }

  /**
   * GET /projects/:projectId/releases/:id/sourcemaps
   * List source maps for a release
   */
  @Get(':id/sourcemaps')
  async listSourceMaps(@Param('id') releaseId: string): Promise<ApiResponse<SourceMap[]>> {
    const sourceMaps = await this.sourceMapsService.findByRelease(releaseId);
    return { success: true, data: sourceMaps };
  }

  /**
   * DELETE /projects/:projectId/releases/:releaseId/sourcemaps/:sourceMapId
   * Delete a source map
   */
  @Delete(':releaseId/sourcemaps/:sourceMapId')
  async deleteSourceMap(
    @Param('sourceMapId') sourceMapId: string
  ): Promise<ApiResponse<{ message: string }>> {
    await this.sourceMapsService.delete(sourceMapId);
    return { success: true, data: { message: 'Source map deleted' } };
  }
}
