import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiKeysService,
  CreateApiKeyDto,
  ApiKeyWithSecret,
} from './api-keys.service.js';
import type { ApiResponse } from '@dex-monit/observability-contracts';
import type { ApiKey } from '@prisma/client';

interface RequestWithUser extends Request {
  user: { id: string };
}

@Controller('projects/:projectId/keys')
@UseGuards(AuthGuard('jwt'))
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  /**
   * POST /projects/:projectId/keys
   * Create a new API key
   */
  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() data: Omit<CreateApiKeyDto, 'projectId'>,
    @Request() req: RequestWithUser,
  ): Promise<ApiResponse<ApiKeyWithSecret>> {
    const apiKey = await this.apiKeysService.create({
      ...data,
      projectId,
      createdById: req.user.id,
    });

    return {
      success: true,
      data: apiKey,
    };
  }

  /**
   * GET /projects/:projectId/keys
   * List all API keys for a project
   */
  @Get()
  async list(
    @Param('projectId') projectId: string,
  ): Promise<ApiResponse<ApiKey[]>> {
    const keys = await this.apiKeysService.findByProject(projectId);
    return { success: true, data: keys };
  }

  /**
   * POST /projects/:projectId/keys/:id/revoke
   * Revoke an API key
   */
  @Post(':id/revoke')
  async revoke(@Param('id') id: string): Promise<ApiResponse<ApiKey>> {
    const apiKey = await this.apiKeysService.revoke(id);
    return { success: true, data: apiKey };
  }

  /**
   * DELETE /projects/:projectId/keys/:id
   * Delete an API key
   */
  @Delete(':id')
  async delete(
    @Param('id') id: string,
  ): Promise<ApiResponse<{ message: string }>> {
    await this.apiKeysService.delete(id);
    return { success: true, data: { message: 'API key deleted' } };
  }
}
