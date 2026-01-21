import { Injectable, Logger } from '@nestjs/common';
import { NotificationPayload } from '../notification.service';

export interface TeamsConfig {
  webhookUrl: string;
}

interface TeamsAdaptiveCard {
  type: 'message';
  attachments: Array<{
    contentType: 'application/vnd.microsoft.card.adaptive';
    contentUrl: null;
    content: {
      $schema: string;
      type: 'AdaptiveCard';
      version: string;
      body: Array<Record<string, unknown>>;
      actions?: Array<Record<string, unknown>>;
    };
  }>;
}

@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  async sendAlert(config: TeamsConfig, payload: NotificationPayload): Promise<void> {
    if (!config.webhookUrl) {
      this.logger.warn('Teams webhook URL not configured');
      return;
    }

    const card = this.buildAdaptiveCard(payload);

    try {
      const response = await fetch(config.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(card),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Teams API error: ${response.status} - ${errorText}`);
      }

      this.logger.log('Teams alert sent successfully');
    } catch (error) {
      this.logger.error('Failed to send Teams alert', error);
      throw error;
    }
  }

  private buildAdaptiveCard(payload: NotificationPayload): TeamsAdaptiveCard {
    const color = this.getSeverityColor(payload.level || 'error');
    const emoji = this.getSeverityEmoji(payload.level || 'error');

    const body: Array<Record<string, unknown>> = [
      {
        type: 'Container',
        style: color,
        items: [
          {
            type: 'TextBlock',
            text: `${emoji} ${payload.level.toUpperCase()} Alert`,
            weight: 'Bolder',
            size: 'Medium',
            color: 'Light',
          },
        ],
      },
      {
        type: 'Container',
        items: [
          {
            type: 'TextBlock',
            text: payload.projectName || 'Unknown Project',
            weight: 'Bolder',
            size: 'Large',
          },
          {
            type: 'TextBlock',
            text: payload.message,
            wrap: true,
            maxLines: 3,
          },
        ],
      },
      {
        type: 'FactSet',
        facts: this.buildFacts(payload),
      },
    ];

    if (payload.stackTrace) {
      body.push({
        type: 'Container',
        items: [
          {
            type: 'TextBlock',
            text: 'Stack Trace',
            weight: 'Bolder',
            size: 'Small',
          },
          {
            type: 'TextBlock',
            text: payload.stackTrace.substring(0, 500),
            wrap: true,
            fontType: 'Monospace',
            size: 'Small',
          },
        ],
      });
    }

    const actions: Array<Record<string, unknown>> = [];

    if (payload.issueUrl) {
      actions.push({
        type: 'Action.OpenUrl',
        title: 'View Issue',
        url: payload.issueUrl,
      });
    }

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body,
            actions: actions.length > 0 ? actions : undefined,
          },
        },
      ],
    };
  }

  private buildFacts(payload: NotificationPayload): Array<{ title: string; value: string }> {
    const facts: Array<{ title: string; value: string }> = [];

    if (payload.environment) {
      facts.push({ title: 'Environment', value: payload.environment });
    }

    if (payload.count) {
      facts.push({ title: 'Occurrences', value: payload.count.toString() });
    }

    if (payload.usersAffected) {
      facts.push({ title: 'Users Affected', value: payload.usersAffected.toString() });
    }

    if (payload.firstSeen) {
      facts.push({
        title: 'First Seen',
        value: new Date(payload.firstSeen).toLocaleString(),
      });
    }

    if (payload.lastSeen) {
      facts.push({
        title: 'Last Seen',
        value: new Date(payload.lastSeen).toLocaleString(),
      });
    }

    if (payload.fingerprint) {
      facts.push({ title: 'Fingerprint', value: payload.fingerprint.substring(0, 16) + '...' });
    }

    return facts;
  }

  private getSeverityColor(level: string): string {
    switch (level.toLowerCase()) {
      case 'fatal':
      case 'critical':
        return 'attention';
      case 'error':
        return 'attention';
      case 'warning':
      case 'warn':
        return 'warning';
      default:
        return 'accent';
    }
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
