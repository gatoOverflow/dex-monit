import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@dex-monit/observability-logger';
import { EmailService } from './email.service.js';
import { PagerDutyService, TeamsService, TelegramService } from './channels/index.js';
import type { AlertAction } from './alert-rules.service.js';
import type { Issue, AlertRule } from '@prisma/client';

export interface NotificationPayload {
  alertId: string;
  title: string;
  message: string;
  issue?: Issue;
  rule: AlertRule;
  // Extended fields for integrations
  level?: string;
  type?: string;
  projectId?: string;
  projectName?: string;
  environment?: string;
  fingerprint?: string;
  issueId?: string;
  issueUrl?: string;
  count?: number;
  usersAffected?: number;
  firstSeen?: string;
  lastSeen?: string;
  stackTrace?: string;
}

@Injectable()
export class NotificationService {
  constructor(
    @Inject(Logger) private readonly logger: Logger,
    private readonly emailService: EmailService,
    private readonly pagerDutyService: PagerDutyService,
    private readonly teamsService: TeamsService,
    private readonly telegramService: TelegramService,
  ) {}

  async send(action: AlertAction, payload: NotificationPayload): Promise<void> {
    switch (action.type) {
      case 'slack':
        await this.sendSlack(action.config, payload);
        break;
      case 'email':
        await this.sendEmail(action.config, payload);
        break;
      case 'webhook':
        await this.sendWebhook(action.config, payload);
        break;
      case 'discord':
        await this.sendDiscord(action.config, payload);
        break;
      case 'pagerduty':
        await this.sendPagerDuty(action.config, payload);
        break;
      case 'teams':
        await this.sendTeams(action.config, payload);
        break;
      case 'telegram':
        await this.sendTelegram(action.config, payload);
        break;
      default:
        this.logger.warn('Unknown notification type', { type: action.type });
    }
  }

  /**
   * Send Slack notification
   */
  private async sendSlack(
    config: Record<string, unknown>,
    payload: NotificationPayload
  ): Promise<void> {
    const webhookUrl = config['webhookUrl'] as string;
    const channel = config['channel'] as string | undefined;

    if (!webhookUrl) {
      throw new Error('Slack webhook URL is required');
    }

    const slackMessage = {
      channel,
      username: 'Dex Monit',
      icon_emoji: ':warning:',
      attachments: [
        {
          color: this.getSeverityColor(payload.issue?.level),
          title: payload.title,
          text: payload.message,
          fields: payload.issue
            ? [
                {
                  title: 'Issue',
                  value: payload.issue.shortId,
                  short: true,
                },
                {
                  title: 'Level',
                  value: payload.issue.level,
                  short: true,
                },
                {
                  title: 'Events',
                  value: payload.issue.eventCount.toString(),
                  short: true,
                },
                {
                  title: 'Users',
                  value: payload.issue.userCount.toString(),
                  short: true,
                },
              ]
            : [],
          footer: 'Dex Monit',
          ts: Math.floor(Date.now() / 1000).toString(),
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status}`);
    }

    this.logger.info('Slack notification sent', { alertId: payload.alertId });
  }

  /**
   * Send email notification
   */
  private async sendEmail(
    config: Record<string, unknown>,
    payload: NotificationPayload
  ): Promise<void> {
    const to = config['to'] as string[];

    if (!to || to.length === 0) {
      throw new Error('Email recipients are required');
    }

    // Check if email service is available
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not configured, skipping notification', {
        alertId: payload.alertId,
        to,
      });
      return;
    }

    await this.emailService.sendAlertNotification(to, payload);
    this.logger.info('Email notification sent', {
      alertId: payload.alertId,
      to,
    });
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(
    config: Record<string, unknown>,
    payload: NotificationPayload
  ): Promise<void> {
    const url = config['url'] as string;
    const headers = config['headers'] as Record<string, string> | undefined;
    const secret = config['secret'] as string | undefined;

    if (!url) {
      throw new Error('Webhook URL is required');
    }

    const webhookPayload = {
      event: 'alert.triggered',
      timestamp: new Date().toISOString(),
      alert: {
        id: payload.alertId,
        title: payload.title,
        message: payload.message,
      },
      issue: payload.issue
        ? {
            id: payload.issue.id,
            shortId: payload.issue.shortId,
            title: payload.issue.title,
            level: payload.issue.level,
            eventCount: payload.issue.eventCount,
            userCount: payload.issue.userCount,
          }
        : null,
      rule: {
        id: payload.rule.id,
        name: payload.rule.name,
        triggerType: payload.rule.triggerType,
      },
    };

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'DexMonit/1.0',
      ...headers,
    };

    // Add signature if secret is configured
    if (secret) {
      const crypto = await import('crypto');
      const signature = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(webhookPayload))
        .digest('hex');
      requestHeaders['X-Dex-Signature'] = signature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(webhookPayload),
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.status}`);
    }

    this.logger.info('Webhook notification sent', {
      alertId: payload.alertId,
      url,
    });
  }

  /**
   * Send Discord notification
   */
  private async sendDiscord(
    config: Record<string, unknown>,
    payload: NotificationPayload
  ): Promise<void> {
    const webhookUrl = config['webhookUrl'] as string;

    if (!webhookUrl) {
      throw new Error('Discord webhook URL is required');
    }

    const discordMessage = {
      username: 'Dex Monit',
      embeds: [
        {
          title: payload.title,
          description: payload.message,
          color: this.getDiscordColor(payload.issue?.level),
          fields: payload.issue
            ? [
                { name: 'Issue', value: payload.issue.shortId, inline: true },
                { name: 'Level', value: payload.issue.level, inline: true },
                { name: 'Events', value: payload.issue.eventCount.toString(), inline: true },
              ]
            : [],
          timestamp: new Date().toISOString(),
          footer: { text: 'Dex Monit' },
        },
      ],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordMessage),
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    this.logger.info('Discord notification sent', { alertId: payload.alertId });
  }

  private getSeverityColor(level?: string): string {
    const colors: Record<string, string> = {
      FATAL: '#8B0000',
      ERROR: '#FF0000',
      WARNING: '#FFA500',
      INFO: '#0000FF',
      DEBUG: '#808080',
    };
    return colors[level || 'ERROR'] || '#FF0000';
  }

  private getDiscordColor(level?: string): number {
    const colors: Record<string, number> = {
      FATAL: 0x8b0000,
      ERROR: 0xff0000,
      WARNING: 0xffa500,
      INFO: 0x0000ff,
      DEBUG: 0x808080,
    };
    return colors[level || 'ERROR'] || 0xff0000;
  }

  /**
   * Send PagerDuty notification
   */
  private async sendPagerDuty(
    config: Record<string, unknown>,
    payload: NotificationPayload,
  ): Promise<void> {
    const routingKey = config['routingKey'] as string;
    const severity = config['severity'] as 'critical' | 'error' | 'warning' | 'info' | undefined;

    if (!routingKey) {
      throw new Error('PagerDuty routing key is required');
    }

    const enrichedPayload = this.enrichPayload(payload);
    await this.pagerDutyService.sendAlert(
      { routingKey, severity },
      enrichedPayload,
    );

    this.logger.info('PagerDuty notification sent', { alertId: payload.alertId });
  }

  /**
   * Send Microsoft Teams notification
   */
  private async sendTeams(
    config: Record<string, unknown>,
    payload: NotificationPayload,
  ): Promise<void> {
    const webhookUrl = config['webhookUrl'] as string;

    if (!webhookUrl) {
      throw new Error('Teams webhook URL is required');
    }

    const enrichedPayload = this.enrichPayload(payload);
    await this.teamsService.sendAlert({ webhookUrl }, enrichedPayload);

    this.logger.info('Teams notification sent', { alertId: payload.alertId });
  }

  /**
   * Send Telegram notification
   */
  private async sendTelegram(
    config: Record<string, unknown>,
    payload: NotificationPayload,
  ): Promise<void> {
    const botToken = config['botToken'] as string;
    const chatId = config['chatId'] as string;
    const parseMode = config['parseMode'] as 'HTML' | 'MarkdownV2' | undefined;

    if (!botToken || !chatId) {
      throw new Error('Telegram bot token and chat ID are required');
    }

    const enrichedPayload = this.enrichPayload(payload);
    await this.telegramService.sendAlert(
      { botToken, chatId, parseMode },
      enrichedPayload,
    );

    this.logger.info('Telegram notification sent', {
      alertId: payload.alertId,
      chatId,
    });
  }

  /**
   * Enrich payload with issue data for integrations
   */
  private enrichPayload(payload: NotificationPayload): NotificationPayload {
    const issue = payload.issue;
    return {
      ...payload,
      level: payload.level || issue?.level || 'ERROR',
      count: payload.count || issue?.eventCount,
      usersAffected: payload.usersAffected || issue?.userCount,
      firstSeen: payload.firstSeen || issue?.firstSeen?.toISOString(),
      lastSeen: payload.lastSeen || issue?.lastSeen?.toISOString(),
      fingerprint: payload.fingerprint || issue?.fingerprint,
      issueId: payload.issueId || issue?.id,
    };
  }
}
