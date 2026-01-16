import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import { AlertRulesService, AlertAction } from './alert-rules.service.js';
import { NotificationService } from './notification.service.js';
import type { Alert, AlertRule, Issue, AlertStatus, Prisma } from '@prisma/client';

export interface TriggerAlertParams {
  rule: AlertRule;
  issue?: Issue;
  title: string;
  message: string;
}

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly alertRulesService: AlertRulesService,
    private readonly notificationService: NotificationService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  /**
   * Trigger an alert based on a rule
   */
  async trigger(params: TriggerAlertParams): Promise<Alert | null> {
    const { rule, issue, title, message } = params;

    // Check cooldown
    const inCooldown = await this.alertRulesService.isInCooldown(rule.id);
    if (inCooldown) {
      this.logger.debug('Alert rule in cooldown, skipping', { ruleId: rule.id });
      return null;
    }

    // Create alert
    const alert = await this.prisma.alert.create({
      data: {
        alertRuleId: rule.id,
        issueId: issue?.id,
        title,
        message,
        status: 'TRIGGERED',
      },
    });

    // Update rule last triggered
    await this.alertRulesService.updateLastTriggered(rule.id);

    // Send notifications
    const actions = rule.actions as unknown as AlertAction[];
    for (const action of actions) {
      try {
        await this.notificationService.send(action, {
          alertId: alert.id,
          title,
          message,
          issue,
          rule,
        });

        // Update delivery status
        await this.prisma.alert.update({
          where: { id: alert.id },
          data: {
            deliveredAt: new Date(),
            deliveryChannel: action.type,
            deliveryStatus: 'success',
          },
        });
      } catch (error) {
        this.logger.error('Failed to send notification', {
          alertId: alert.id,
          actionType: action.type,
          error: error instanceof Error ? error.message : 'Unknown error',
        });

        await this.prisma.alert.update({
          where: { id: alert.id },
          data: {
            deliveryStatus: 'failed',
            deliveryChannel: action.type,
          },
        });
      }
    }

    this.logger.info('Alert triggered', {
      alertId: alert.id,
      ruleId: rule.id,
      issueId: issue?.id,
    });

    return alert;
  }

  /**
   * Check and trigger alerts for a new issue
   */
  async checkNewIssue(issue: Issue): Promise<void> {
    const rules = await this.alertRulesService.findActiveByProject(issue.projectId);

    for (const rule of rules) {
      if (rule.triggerType !== 'NEW_ISSUE') continue;

      // Check environment filter
      if (rule.environment) {
        // Would need to check against issue environment
      }

      // Check level filter
      if (rule.level && rule.level !== issue.level) continue;

      await this.trigger({
        rule,
        issue,
        title: `New Issue: ${issue.title}`,
        message: `A new ${issue.level.toLowerCase()} issue was detected: ${issue.title}\n\nCulprit: ${issue.culprit || 'Unknown'}`,
      });
    }
  }

  /**
   * Check and trigger alerts for a regressed issue
   */
  async checkRegression(issue: Issue): Promise<void> {
    const rules = await this.alertRulesService.findActiveByProject(issue.projectId);

    for (const rule of rules) {
      if (rule.triggerType !== 'ISSUE_REGRESSION') continue;

      await this.trigger({
        rule,
        issue,
        title: `Issue Regression: ${issue.title}`,
        message: `A previously resolved issue has reappeared: ${issue.title}\n\nCulprit: ${issue.culprit || 'Unknown'}`,
      });
    }
  }

  /**
   * Check threshold-based alerts
   */
  async checkThreshold(projectId: string): Promise<void> {
    const rules = await this.alertRulesService.findActiveByProject(projectId);

    for (const rule of rules) {
      if (rule.triggerType !== 'THRESHOLD') continue;

      const windowStart = new Date(Date.now() - rule.timeWindow * 1000);

      // Count events in time window
      const eventCount = await this.prisma.event.count({
        where: {
          projectId,
          timestamp: { gte: windowStart },
          ...(rule.level && { level: rule.level }),
          ...(rule.environment && { environment: rule.environment }),
        },
      });

      if (eventCount >= rule.threshold) {
        await this.trigger({
          rule,
          title: `Threshold Alert: ${eventCount} events`,
          message: `${eventCount} events occurred in the last ${rule.timeWindow} seconds (threshold: ${rule.threshold})`,
        });
      }
    }
  }

  /**
   * Find alerts by rule
   */
  async findByRule(
    ruleId: string,
    params: { skip?: number; take?: number }
  ): Promise<{ data: Alert[]; total: number }> {
    const { skip = 0, take = 20 } = params;

    const [alerts, total] = await Promise.all([
      this.prisma.alert.findMany({
        where: { alertRuleId: ruleId },
        skip,
        take,
        orderBy: { triggeredAt: 'desc' },
        include: { issue: true },
      }),
      this.prisma.alert.count({ where: { alertRuleId: ruleId } }),
    ]);

    return { data: alerts, total };
  }

  /**
   * Acknowledge an alert
   */
  async acknowledge(id: string): Promise<Alert> {
    return this.prisma.alert.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED' },
    });
  }

  /**
   * Resolve an alert
   */
  async resolve(id: string, userId: string): Promise<Alert> {
    return this.prisma.alert.update({
      where: { id },
      data: {
        status: 'RESOLVED',
        resolvedAt: new Date(),
        resolvedById: userId,
      },
    });
  }
}
