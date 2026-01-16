import { Injectable, Inject } from '@nestjs/common';
import { Logger } from '@dex-monit/observability-logger';
import type { AlertAction } from './alert-rules.service.js';
import type { Issue, AlertRule } from '@prisma/client';

export interface NotificationPayload {
  alertId: string;
  title: string;
  message: string;
  issue?: Issue;
  rule: AlertRule;
}

@Injectable()
export class NotificationService {
  constructor(@Inject(Logger) private readonly logger: Logger) {}

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

    // TODO: Implement email sending (using nodemailer, SendGrid, etc.)
    this.logger.info('Email notification would be sent', {
      alertId: payload.alertId,
      to,
    });

    // Placeholder - implement with actual email service
    // await this.emailService.send({
    //   to,
    //   subject: payload.title,
    //   html: this.buildEmailHtml(payload),
    // });
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
}
