import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { Logger } from '@dex-monit/observability-logger';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { NotificationPayload } from './notification.service.js';

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth?: {
    user: string;
    pass: string;
  };
  from: string;
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class EmailService implements OnModuleInit {
  private transporter: Transporter | null = null;
  private readonly config: EmailConfig;
  private readonly enabled: boolean;

  constructor(@Inject(Logger) private readonly logger: Logger) {
    // Load configuration from environment
    this.enabled = process.env['SMTP_ENABLED'] === 'true';
    this.config = {
      host: process.env['SMTP_HOST'] || 'localhost',
      port: parseInt(process.env['SMTP_PORT'] || '587', 10),
      secure: process.env['SMTP_SECURE'] === 'true',
      auth: process.env['SMTP_USER']
        ? {
            user: process.env['SMTP_USER'],
            pass: process.env['SMTP_PASS'] || '',
          }
        : undefined,
      from: process.env['SMTP_FROM'] || 'Dex Monit <noreply@dexmonit.local>',
    };
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.info('Email service disabled (SMTP_ENABLED !== true)');
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.auth,
      });

      // Verify connection
      await this.transporter.verify();
      this.logger.info('Email service initialized', {
        host: this.config.host,
        port: this.config.port,
      });
    } catch (error) {
      this.logger.error('Failed to initialize email service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      this.transporter = null;
    }
  }

  /**
   * Check if email service is available
   */
  isAvailable(): boolean {
    return this.enabled && this.transporter !== null;
  }

  /**
   * Send an email
   */
  async send(options: SendEmailOptions): Promise<void> {
    if (!this.isAvailable()) {
      this.logger.warn('Email service not available, skipping send', {
        to: options.to,
        subject: options.subject,
      });
      return;
    }

    try {
      const info = await this.transporter!.sendMail({
        from: this.config.from,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      this.logger.info('Email sent successfully', {
        messageId: info.messageId,
        to: options.to,
      });
    } catch (error) {
      this.logger.error('Failed to send email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        to: options.to,
      });
      throw error;
    }
  }

  /**
   * Send alert notification email
   */
  async sendAlertNotification(
    to: string[],
    payload: NotificationPayload
  ): Promise<void> {
    const html = this.buildAlertEmailHtml(payload);
    const text = this.buildAlertEmailText(payload);

    await this.send({
      to,
      subject: `[Alert] ${payload.title}`,
      html,
      text,
    });
  }

  /**
   * Send welcome email to new user
   */
  async sendWelcomeEmail(
    to: string,
    userName: string,
    loginUrl: string
  ): Promise<void> {
    const html = this.buildWelcomeEmailHtml(userName, loginUrl);
    const text = `Welcome to Dex Monit, ${userName}!\n\nYou can log in at: ${loginUrl}`;

    await this.send({
      to,
      subject: 'Welcome to Dex Monit',
      html,
      text,
    });
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    to: string,
    resetUrl: string,
    expiresIn: string
  ): Promise<void> {
    const html = this.buildPasswordResetEmailHtml(resetUrl, expiresIn);
    const text = `Password Reset Request\n\nClick the following link to reset your password: ${resetUrl}\n\nThis link will expire in ${expiresIn}.`;

    await this.send({
      to,
      subject: 'Password Reset Request - Dex Monit',
      html,
      text,
    });
  }

  // ============ Email Templates ============

  private buildAlertEmailHtml(payload: NotificationPayload): string {
    const severityColor = this.getSeverityColor(payload.issue?.level);
    const issueSection = payload.issue
      ? `
        <div style="background-color: #f9fafb; border-radius: 8px; padding: 16px; margin-top: 16px;">
          <h3 style="margin: 0 0 12px 0; color: #374151; font-size: 14px;">Issue Details</h3>
          <table style="width: 100%; font-size: 14px;">
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Issue ID:</td>
              <td style="padding: 4px 0; color: #111827; font-family: monospace;">${payload.issue.shortId}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Title:</td>
              <td style="padding: 4px 0; color: #111827;">${this.escapeHtml(payload.issue.title)}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Level:</td>
              <td style="padding: 4px 0;">
                <span style="display: inline-block; padding: 2px 8px; border-radius: 4px; background-color: ${severityColor}; color: white; font-size: 12px;">
                  ${payload.issue.level}
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Events:</td>
              <td style="padding: 4px 0; color: #111827;">${payload.issue.eventCount}</td>
            </tr>
            <tr>
              <td style="padding: 4px 0; color: #6b7280;">Users Affected:</td>
              <td style="padding: 4px 0; color: #111827;">${payload.issue.userCount}</td>
            </tr>
          </table>
        </div>
      `
      : '';

    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
              <!-- Header -->
              <div style="background-color: ${severityColor}; padding: 20px 24px;">
                <h1 style="margin: 0; color: white; font-size: 18px; font-weight: 600;">
                  Alert Triggered
                </h1>
              </div>

              <!-- Content -->
              <div style="padding: 24px;">
                <h2 style="margin: 0 0 16px 0; color: #111827; font-size: 20px;">
                  ${this.escapeHtml(payload.title)}
                </h2>

                <p style="margin: 0 0 16px 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                  ${this.escapeHtml(payload.message)}
                </p>

                ${issueSection}

                <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb;">
                  <p style="margin: 0; color: #6b7280; font-size: 13px;">
                    Rule: <strong>${this.escapeHtml(payload.rule.name)}</strong>
                  </p>
                </div>
              </div>

              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
                <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                  Sent by Dex Monit
                </p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private buildAlertEmailText(payload: NotificationPayload): string {
    let text = `ALERT: ${payload.title}\n\n${payload.message}\n`;

    if (payload.issue) {
      text += `\nIssue Details:\n`;
      text += `- ID: ${payload.issue.shortId}\n`;
      text += `- Title: ${payload.issue.title}\n`;
      text += `- Level: ${payload.issue.level}\n`;
      text += `- Events: ${payload.issue.eventCount}\n`;
      text += `- Users: ${payload.issue.userCount}\n`;
    }

    text += `\nRule: ${payload.rule.name}`;
    return text;
  }

  private buildWelcomeEmailHtml(userName: string, loginUrl: string): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
              <!-- Header -->
              <div style="background-color: #3b82f6; padding: 20px 24px;">
                <h1 style="margin: 0; color: white; font-size: 18px; font-weight: 600;">
                  Welcome to Dex Monit
                </h1>
              </div>

              <!-- Content -->
              <div style="padding: 24px;">
                <h2 style="margin: 0 0 16px 0; color: #111827; font-size: 20px;">
                  Hello, ${this.escapeHtml(userName)}!
                </h2>

                <p style="margin: 0 0 16px 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                  Your account has been created successfully. You can now start monitoring your applications with Dex Monit.
                </p>

                <p style="margin: 0 0 24px 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                  Get started by creating your first project and integrating our SDK into your application.
                </p>

                <a href="${loginUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                  Go to Dashboard
                </a>
              </div>

              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
                <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                  Dex Monit - Error Monitoring & Log Management
                </p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  private buildPasswordResetEmailHtml(
    resetUrl: string,
    expiresIn: string
  ): string {
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f3f4f6;">
          <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
              <!-- Header -->
              <div style="background-color: #f59e0b; padding: 20px 24px;">
                <h1 style="margin: 0; color: white; font-size: 18px; font-weight: 600;">
                  Password Reset Request
                </h1>
              </div>

              <!-- Content -->
              <div style="padding: 24px;">
                <p style="margin: 0 0 16px 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                  We received a request to reset your password. Click the button below to create a new password.
                </p>

                <p style="margin: 0 0 24px 0; color: #4b5563; font-size: 15px; line-height: 1.6;">
                  This link will expire in <strong>${expiresIn}</strong>.
                </p>

                <a href="${resetUrl}" style="display: inline-block; background-color: #f59e0b; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">
                  Reset Password
                </a>

                <p style="margin: 24px 0 0 0; color: #9ca3af; font-size: 13px; line-height: 1.6;">
                  If you didn't request a password reset, you can safely ignore this email.
                </p>
              </div>

              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 16px 24px; text-align: center;">
                <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                  Dex Monit - Error Monitoring & Log Management
                </p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;
  }

  // ============ Helpers ============

  private escapeHtml(text: string): string {
    const htmlEscapes: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
  }

  private getSeverityColor(level?: string): string {
    const colors: Record<string, string> = {
      FATAL: '#991b1b',
      ERROR: '#dc2626',
      WARNING: '#d97706',
      INFO: '#2563eb',
      DEBUG: '#6b7280',
    };
    return colors[level || 'ERROR'] || '#dc2626';
  }
}
