import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import type { AlertRule, AlertTriggerType, Severity, Prisma } from '@prisma/client';

export interface CreateAlertRuleDto {
  projectId: string;
  name: string;
  description?: string;
  triggerType: AlertTriggerType;
  conditions?: Record<string, unknown>;
  threshold?: number;
  timeWindow?: number;
  environment?: string;
  level?: Severity;
  actions: AlertAction[];
  cooldownMinutes?: number;
}

export interface UpdateAlertRuleDto {
  name?: string;
  description?: string;
  isEnabled?: boolean;
  conditions?: Record<string, unknown>;
  threshold?: number;
  timeWindow?: number;
  environment?: string;
  level?: Severity;
  actions?: AlertAction[];
  cooldownMinutes?: number;
}

export interface AlertAction {
  type: 'slack' | 'email' | 'webhook' | 'discord' | 'pagerduty' | 'teams' | 'telegram';
  config: Record<string, unknown>;
}

@Injectable()
export class AlertRulesService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async create(data: CreateAlertRuleDto): Promise<AlertRule> {
    // Map triggerType to uppercase enum value
    const triggerTypeMap: Record<string, AlertTriggerType> = {
      'new_issue': 'NEW_ISSUE',
      'issue_regression': 'ISSUE_REGRESSION',
      'threshold': 'THRESHOLD',
      'spike': 'SPIKE',
      'custom': 'CUSTOM',
      'NEW_ISSUE': 'NEW_ISSUE',
      'ISSUE_REGRESSION': 'ISSUE_REGRESSION',
      'THRESHOLD': 'THRESHOLD',
      'SPIKE': 'SPIKE',
      'CUSTOM': 'CUSTOM',
    };

    const triggerType = triggerTypeMap[data.triggerType as string] || 'THRESHOLD';

    const alertRule = await this.prisma.alertRule.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        description: data.description,
        triggerType,
        conditions: (data.conditions || {}) as Prisma.JsonValue,
        threshold: data.threshold || 1,
        timeWindow: data.timeWindow || 60,
        environment: data.environment,
        level: data.level,
        actions: data.actions as unknown as Prisma.JsonValue,
        cooldownMinutes: data.cooldownMinutes || 30,
      },
    });

    this.logger.info('Alert rule created', {
      alertRuleId: alertRule.id,
      name: alertRule.name,
    });

    return alertRule;
  }

  async findById(id: string): Promise<AlertRule | null> {
    return this.prisma.alertRule.findUnique({ where: { id } });
  }

  async findByIdOrThrow(id: string): Promise<AlertRule> {
    const rule = await this.findById(id);
    if (!rule) {
      throw new NotFoundException('Alert rule not found');
    }
    return rule;
  }

  async findByProject(projectId: string): Promise<AlertRule[]> {
    return this.prisma.alertRule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findActiveByProject(projectId: string): Promise<AlertRule[]> {
    return this.prisma.alertRule.findMany({
      where: {
        projectId,
        isEnabled: true,
      },
    });
  }

  async update(id: string, data: UpdateAlertRuleDto): Promise<AlertRule> {
    const alertRule = await this.prisma.alertRule.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        isEnabled: data.isEnabled,
        conditions: data.conditions as Prisma.JsonValue,
        threshold: data.threshold,
        timeWindow: data.timeWindow,
        environment: data.environment,
        level: data.level,
        actions: data.actions as unknown as Prisma.JsonValue,
        cooldownMinutes: data.cooldownMinutes,
      },
    });

    this.logger.info('Alert rule updated', { alertRuleId: id });

    return alertRule;
  }

  async enable(id: string): Promise<AlertRule> {
    return this.prisma.alertRule.update({
      where: { id },
      data: { isEnabled: true },
    });
  }

  async disable(id: string): Promise<AlertRule> {
    return this.prisma.alertRule.update({
      where: { id },
      data: { isEnabled: false },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.alertRule.delete({ where: { id } });
    this.logger.info('Alert rule deleted', { alertRuleId: id });
  }

  async updateLastTriggered(id: string): Promise<void> {
    await this.prisma.alertRule.update({
      where: { id },
      data: { lastTriggeredAt: new Date() },
    });
  }

  /**
   * Check if alert rule is in cooldown period
   */
  async isInCooldown(id: string): Promise<boolean> {
    const rule = await this.findById(id);
    if (!rule || !rule.lastTriggeredAt) {
      return false;
    }

    const cooldownEnd = new Date(
      rule.lastTriggeredAt.getTime() + rule.cooldownMinutes * 60 * 1000
    );

    return new Date() < cooldownEnd;
  }
}
