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
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AlertRulesService, CreateAlertRuleDto, UpdateAlertRuleDto } from './alert-rules.service.js';
import { AlertsService } from './alerts.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';
import type { AlertRule, Alert } from '@prisma/client';

interface RequestWithUser extends Request {
  user: { id: string };
}

@Controller('projects/:projectId/alert-rules')
@UseGuards(AuthGuard('jwt'))
export class AlertRulesController {
  constructor(
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService
  ) {}

  /**
   * POST /projects/:projectId/alert-rules
   * Create an alert rule
   */
  @Post()
  async create(
    @Param('projectId') projectId: string,
    @Body() data: Omit<CreateAlertRuleDto, 'projectId'>
  ): Promise<ApiResponse<AlertRule>> {
    const rule = await this.alertRulesService.create({
      ...data,
      projectId,
    });
    return { success: true, data: rule };
  }

  /**
   * GET /projects/:projectId/alert-rules
   * List alert rules for a project
   */
  @Get()
  async list(@Param('projectId') projectId: string): Promise<ApiResponse<AlertRule[]>> {
    const rules = await this.alertRulesService.findByProject(projectId);
    return { success: true, data: rules };
  }

  /**
   * GET /projects/:projectId/alert-rules/:id
   * Get an alert rule
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<AlertRule>> {
    const rule = await this.alertRulesService.findByIdOrThrow(id);
    return { success: true, data: rule };
  }

  /**
   * PUT /projects/:projectId/alert-rules/:id
   * Update an alert rule
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateAlertRuleDto
  ): Promise<ApiResponse<AlertRule>> {
    const rule = await this.alertRulesService.update(id, data);
    return { success: true, data: rule };
  }

  /**
   * POST /projects/:projectId/alert-rules/:id/enable
   * Enable an alert rule
   */
  @Post(':id/enable')
  async enable(@Param('id') id: string): Promise<ApiResponse<AlertRule>> {
    const rule = await this.alertRulesService.enable(id);
    return { success: true, data: rule };
  }

  /**
   * POST /projects/:projectId/alert-rules/:id/disable
   * Disable an alert rule
   */
  @Post(':id/disable')
  async disable(@Param('id') id: string): Promise<ApiResponse<AlertRule>> {
    const rule = await this.alertRulesService.disable(id);
    return { success: true, data: rule };
  }

  /**
   * DELETE /projects/:projectId/alert-rules/:id
   * Delete an alert rule
   */
  @Delete(':id')
  async delete(@Param('id') id: string): Promise<ApiResponse<{ message: string }>> {
    await this.alertRulesService.delete(id);
    return { success: true, data: { message: 'Alert rule deleted' } };
  }

  /**
   * GET /projects/:projectId/alert-rules/:id/alerts
   * Get alerts for a rule
   */
  @Get(':id/alerts')
  async getAlerts(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ): Promise<ApiResponse<PaginatedResponse<Alert>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '20', 10);

    const { data, total } = await this.alertsService.findByRule(id, {
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
   * POST /projects/:projectId/alert-rules/:ruleId/alerts/:alertId/acknowledge
   * Acknowledge an alert
   */
  @Post(':ruleId/alerts/:alertId/acknowledge')
  async acknowledgeAlert(@Param('alertId') alertId: string): Promise<ApiResponse<Alert>> {
    const alert = await this.alertsService.acknowledge(alertId);
    return { success: true, data: alert };
  }

  /**
   * POST /projects/:projectId/alert-rules/:ruleId/alerts/:alertId/resolve
   * Resolve an alert
   */
  @Post(':ruleId/alerts/:alertId/resolve')
  async resolveAlert(
    @Param('alertId') alertId: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<Alert>> {
    const alert = await this.alertsService.resolve(alertId, req.user.id);
    return { success: true, data: alert };
  }
}
