import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProjectsService, CreateProjectDto, UpdateProjectDto } from './projects.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';
import type { Project } from '@prisma/client';

@Controller('projects')
@UseGuards(AuthGuard('jwt'))
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * POST /projects
   * Create a new project
   */
  @Post()
  async create(@Body() data: CreateProjectDto): Promise<ApiResponse<Project>> {
    const project = await this.projectsService.create(data);
    return { success: true, data: project };
  }

  /**
   * GET /projects
   * List all projects
   */
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('teamId') teamId?: string
  ): Promise<ApiResponse<PaginatedResponse<Project>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '20', 10);

    const where = teamId ? { teamId } : undefined;

    const { data, total } = await this.projectsService.list({
      skip: (pageNum - 1) * size,
      take: size,
      where,
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
   * GET /projects/:id
   * Get a single project
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<Project>> {
    const project = await this.projectsService.findByIdOrThrow(id);
    return { success: true, data: project };
  }

  /**
   * GET /projects/:id/stats
   * Get project statistics
   */
  @Get(':id/stats')
  async getStats(@Param('id') id: string): Promise<ApiResponse<{
    totalIssues: number;
    unresolvedIssues: number;
    totalEvents: number;
    eventsLast24h: number;
    eventsLast7d: number;
  }>> {
    const stats = await this.projectsService.getStats(id);
    return { success: true, data: stats };
  }

  /**
   * PUT /projects/:id
   * Update a project
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateProjectDto
  ): Promise<ApiResponse<Project>> {
    const project = await this.projectsService.update(id, data);
    return { success: true, data: project };
  }

  /**
   * POST /projects/:id/archive
   * Archive a project
   */
  @Post(':id/archive')
  async archive(@Param('id') id: string): Promise<ApiResponse<Project>> {
    const project = await this.projectsService.archive(id);
    return { success: true, data: project };
  }

  /**
   * DELETE /projects/:id
   * Delete a project
   */
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<ApiResponse<{ message: string }>> {
    await this.projectsService.delete(id);
    return { success: true, data: { message: 'Project deleted' } };
  }
}
