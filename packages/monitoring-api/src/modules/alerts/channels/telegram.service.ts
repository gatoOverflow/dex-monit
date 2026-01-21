import { Injectable, Logger } from '@nestjs/common';
import { NotificationPayload } from '../notification.service';

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  parseMode?: 'HTML' | 'MarkdownV2';
  disableNotification?: boolean;
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly baseUrl = 'https://api.telegram.org';

  async sendAlert(config: TelegramConfig, payload: NotificationPayload): Promise<void> {
    if (!config.botToken || !config.chatId) {
      this.logger.warn('Telegram bot token or chat ID not configured');
      return;
    }

    const message = this.formatMessage(payload, config.parseMode || 'HTML');
    const url = `${this.baseUrl}/bot${config.botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: config.chatId,
          text: message,
          parse_mode: config.parseMode || 'HTML',
          disable_notification: config.disableNotification || false,
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json()) as { description?: string };
        throw new Error(`Telegram API error: ${response.status} - ${errorData.description || 'Unknown error'}`);
      }

      const result = (await response.json()) as { ok: boolean; description?: string };
      if (!result.ok) {
        throw new Error(`Telegram API error: ${result.description || 'Unknown error'}`);
      }

      this.logger.log(`Telegram alert sent successfully to chat ${config.chatId}`);
    } catch (error) {
      this.logger.error('Failed to send Telegram alert', error);
      throw error;
    }
  }

  private formatMessage(payload: NotificationPayload, parseMode: 'HTML' | 'MarkdownV2'): string {
    if (parseMode === 'HTML') {
      return this.formatHtmlMessage(payload);
    }
    return this.formatMarkdownMessage(payload);
  }

  private formatHtmlMessage(payload: NotificationPayload): string {
    const emoji = this.getSeverityEmoji(payload.level || 'error');
    const lines: string[] = [];

    lines.push(`${emoji} <b>${this.escapeHtml((payload.level || 'ERROR').toUpperCase())} Alert</b>`);
    lines.push('');

    if (payload.projectName) {
      lines.push(`<b>Project:</b> ${this.escapeHtml(payload.projectName)}`);
    }

    lines.push(`<b>Message:</b> ${this.escapeHtml(payload.message.substring(0, 200))}`);

    if (payload.environment) {
      lines.push(`<b>Environment:</b> ${this.escapeHtml(payload.environment)}`);
    }

    if (payload.count && payload.count > 1) {
      lines.push(`<b>Occurrences:</b> ${payload.count}`);
    }

    if (payload.usersAffected) {
      lines.push(`<b>Users Affected:</b> ${payload.usersAffected}`);
    }

    if (payload.firstSeen) {
      lines.push(`<b>First Seen:</b> ${new Date(payload.firstSeen).toLocaleString()}`);
    }

    if (payload.lastSeen) {
      lines.push(`<b>Last Seen:</b> ${new Date(payload.lastSeen).toLocaleString()}`);
    }

    if (payload.stackTrace) {
      lines.push('');
      lines.push('<b>Stack Trace:</b>');
      lines.push(`<pre>${this.escapeHtml(payload.stackTrace.substring(0, 500))}</pre>`);
    }

    if (payload.issueUrl) {
      lines.push('');
      lines.push(`<a href="${payload.issueUrl}">View Issue in Dex Monitoring</a>`);
    }

    return lines.join('\n');
  }

  private formatMarkdownMessage(payload: NotificationPayload): string {
    const emoji = this.getSeverityEmoji(payload.level || 'error');
    const lines: string[] = [];

    lines.push(`${emoji} *${this.escapeMarkdownV2((payload.level || 'ERROR').toUpperCase())} Alert*`);
    lines.push('');

    if (payload.projectName) {
      lines.push(`*Project:* ${this.escapeMarkdownV2(payload.projectName)}`);
    }

    lines.push(`*Message:* ${this.escapeMarkdownV2(payload.message.substring(0, 200))}`);

    if (payload.environment) {
      lines.push(`*Environment:* ${this.escapeMarkdownV2(payload.environment)}`);
    }

    if (payload.count && payload.count > 1) {
      lines.push(`*Occurrences:* ${payload.count}`);
    }

    if (payload.usersAffected) {
      lines.push(`*Users Affected:* ${payload.usersAffected}`);
    }

    if (payload.firstSeen) {
      lines.push(`*First Seen:* ${this.escapeMarkdownV2(new Date(payload.firstSeen).toLocaleString())}`);
    }

    if (payload.lastSeen) {
      lines.push(`*Last Seen:* ${this.escapeMarkdownV2(new Date(payload.lastSeen).toLocaleString())}`);
    }

    if (payload.stackTrace) {
      lines.push('');
      lines.push('*Stack Trace:*');
      lines.push('```');
      lines.push(payload.stackTrace.substring(0, 500));
      lines.push('```');
    }

    if (payload.issueUrl) {
      lines.push('');
      lines.push(`[View Issue in Dex Monitoring](${this.escapeMarkdownV2(payload.issueUrl)})`);
    }

    return lines.join('\n');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private escapeMarkdownV2(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  private getSeverityEmoji(level: string): string {
    switch (level.toLowerCase()) {
      case 'fatal':
      case 'critical':
        return '🚨';
      case 'error':
        return '❌';
      case 'warning':
      case 'warn':
        return '⚠️';
      default:
        return 'ℹ️';
    }
  }
}
