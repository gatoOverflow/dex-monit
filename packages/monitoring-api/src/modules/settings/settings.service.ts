import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import * as nodemailer from 'nodemailer';

export interface SlackConfig {
  webhookUrl: string;
  channel: string;
  enabled: boolean;
}

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPassword: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

export interface WebhookConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  enabled: boolean;
}

export interface IntegrationSettings {
  slack?: SlackConfig;
  email?: EmailConfig;
  webhook?: WebhookConfig;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Get settings for a team
   */
  async getSettings(teamId: string): Promise<IntegrationSettings> {
    const settings = await this.prisma.teamSettings.findUnique({
      where: { teamId },
    });

    if (!settings) {
      return {};
    }

    return {
      slack: settings.slackConfig as SlackConfig | undefined,
      email: settings.emailConfig as EmailConfig | undefined,
      webhook: settings.webhookConfig as WebhookConfig | undefined,
    };
  }

  /**
   * Save Slack configuration
   */
  async saveSlackConfig(teamId: string, config: SlackConfig): Promise<void> {
    await this.prisma.teamSettings.upsert({
      where: { teamId },
      update: { slackConfig: config as any },
      create: {
        teamId,
        slackConfig: config as any,
      },
    });

    this.logger.info('Slack config saved', { teamId, enabled: config.enabled });
  }

  /**
   * Save Email configuration
   */
  async saveEmailConfig(teamId: string, config: EmailConfig): Promise<void> {
    await this.prisma.teamSettings.upsert({
      where: { teamId },
      update: { emailConfig: config as any },
      create: {
        teamId,
        emailConfig: config as any,
      },
    });

    this.logger.info('Email config saved', { teamId, enabled: config.enabled });
  }

  /**
   * Save Webhook configuration
   */
  async saveWebhookConfig(teamId: string, config: WebhookConfig): Promise<void> {
    await this.prisma.teamSettings.upsert({
      where: { teamId },
      update: { webhookConfig: config as any },
      create: {
        teamId,
        webhookConfig: config as any,
      },
    });

    this.logger.info('Webhook config saved', { teamId, enabled: config.enabled });
  }

  /**
   * Test Slack notification
   */
  async testSlack(config: SlackConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.webhookUrl) {
      return { success: false, error: 'Webhook URL is required' };
    }

    try {
      const message = {
        channel: config.channel || undefined,
        username: 'Dex Monitoring',
        icon_emoji: ':white_check_mark:',
        attachments: [
          {
            color: '#36a64f',
            title: '✅ Test Notification',
            text: 'If you see this message, your Slack integration is working correctly!',
            footer: 'Dex Monitoring',
            ts: Math.floor(Date.now() / 1000).toString(),
          },
        ],
      };

      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const text = await response.text();
        this.logger.error('Slack test failed', { status: response.status, body: text });
        return { success: false, error: `Slack API error: ${response.status} - ${text}` };
      }

      this.logger.info('Slack test notification sent successfully');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Slack test failed', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Test Email notification
   */
  async testEmail(config: EmailConfig, toEmail: string): Promise<{ success: boolean; error?: string }> {
    if (!config.smtpHost || !config.smtpUser || !config.smtpPassword) {
      return { success: false, error: 'SMTP configuration is incomplete' };
    }

    try {
      // Create transporter
      const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465, // true for 465, false for other ports
        auth: {
          user: config.smtpUser,
          pass: config.smtpPassword,
        },
      });

      // Verify connection
      await transporter.verify();

      // Send test email
      const result = await transporter.sendMail({
        from: `"${config.fromName || 'Dex Monitoring'}" <${config.fromEmail || config.smtpUser}>`,
        to: toEmail,
        subject: '✅ Test Email from Dex Monitoring',
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">🎉 Email Integration Working!</h1>
            </div>
            <div style="background: #1a1a2e; padding: 30px; border-radius: 0 0 12px 12px; color: #e0e0e0;">
              <p style="margin: 0 0 15px 0;">Great news! Your SMTP configuration is working correctly.</p>
              <p style="margin: 0 0 15px 0;">You will now receive email notifications for:</p>
              <ul style="margin: 0 0 15px 0; padding-left: 20px;">
                <li>New errors and issues</li>
                <li>Alert triggers</li>
                <li>Performance anomalies</li>
              </ul>
              <hr style="border: none; border-top: 1px solid #333; margin: 20px 0;">
              <p style="margin: 0; font-size: 12px; color: #888;">
                This is a test email from Dex Monitoring. 
                If you did not request this test, you can safely ignore this email.
              </p>
            </div>
          </div>
        `,
      });

      this.logger.info('Test email sent successfully', { messageId: result.messageId });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Email test failed', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Test Webhook
   */
  async testWebhook(config: WebhookConfig): Promise<{ success: boolean; error?: string }> {
    if (!config.url) {
      return { success: false, error: 'Webhook URL is required' };
    }

    try {
      const testPayload = {
        event: 'test',
        timestamp: new Date().toISOString(),
        message: 'This is a test webhook from Dex Monitoring',
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'DexMonitoring/1.0',
        ...config.headers,
      };

      // Add signature if secret is configured
      if (config.secret) {
        const crypto = await import('crypto');
        const signature = crypto
          .createHmac('sha256', config.secret)
          .update(JSON.stringify(testPayload))
          .digest('hex');
        headers['X-Dex-Signature'] = signature;
      }

      const response = await fetch(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(testPayload),
      });

      if (!response.ok) {
        return { success: false, error: `Webhook returned ${response.status}` };
      }

      this.logger.info('Webhook test successful', { url: config.url });
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Webhook test failed', { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
}
