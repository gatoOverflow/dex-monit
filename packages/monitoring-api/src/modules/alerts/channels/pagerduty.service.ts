import { Injectable, Logger } from '@nestjs/common';
import { NotificationPayload } from '../notification.service';

export interface PagerDutyConfig {
  routingKey: string;
  severity?: 'critical' | 'error' | 'warning' | 'info';
}

interface PagerDutyEvent {
  routing_key: string;
  event_action: 'trigger' | 'acknowledge' | 'resolve';
  dedup_key?: string;
  payload: {
    summary: string;
    severity: 'critical' | 'error' | 'warning' | 'info';
    source: string;
    timestamp?: string;
    component?: string;
    group?: string;
    class?: string;
    custom_details?: Record<string, unknown>;
  };
  links?: Array<{ href: string; text: string }>;
  images?: Array<{ src: string; href?: string; alt?: string }>;
}

@Injectable()
export class PagerDutyService {
  private readonly logger = new Logger(PagerDutyService.name);
  private readonly apiUrl = 'https://events.pagerduty.com/v2/enqueue';

  async sendAlert(config: PagerDutyConfig, payload: NotificationPayload): Promise<void> {
    if (!config.routingKey) {
      this.logger.warn('PagerDuty routing key not configured');
      return;
    }

    const severity = this.mapSeverity(payload.level || 'error', config.severity);
    const dedupKey = `dex-${payload.projectId || 'unknown'}-${payload.fingerprint || payload.issueId || 'unknown'}`;

    const event: PagerDutyEvent = {
      routing_key: config.routingKey,
      event_action: 'trigger',
      dedup_key: dedupKey,
      payload: {
        summary: this.formatSummary(payload),
        severity,
        source: payload.projectName || 'Dex Monitoring',
        timestamp: new Date().toISOString(),
        component: payload.environment,
        group: payload.projectName,
        class: payload.type,
        custom_details: {
          error_message: payload.message,
          error_count: payload.count,
          fingerprint: payload.fingerprint,
          environment: payload.environment,
          first_seen: payload.firstSeen,
          last_seen: payload.lastSeen,
          users_affected: payload.usersAffected,
          stack_trace: payload.stackTrace?.substring(0, 1000),
        },
      },
      links: payload.issueUrl
        ? [{ href: payload.issueUrl, text: 'View in Dex Monitoring' }]
        : undefined,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PagerDuty API error: ${response.status} - ${errorText}`);
      }

      const result = (await response.json()) as { dedup_key: string };
      this.logger.log(`PagerDuty alert sent successfully: ${result.dedup_key}`);
    } catch (error) {
      this.logger.error('Failed to send PagerDuty alert', error);
      throw error;
    }
  }

  async resolveAlert(config: PagerDutyConfig, dedupKey: string): Promise<void> {
    if (!config.routingKey) {
      return;
    }

    const event = {
      routing_key: config.routingKey,
      event_action: 'resolve',
      dedup_key: dedupKey,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`PagerDuty API error: ${response.status} - ${errorText}`);
      }

      this.logger.log(`PagerDuty alert resolved: ${dedupKey}`);
    } catch (error) {
      this.logger.error('Failed to resolve PagerDuty alert', error);
      throw error;
    }
  }

  private formatSummary(payload: NotificationPayload): string {
    const parts = [
      `[${payload.level.toUpperCase()}]`,
      payload.projectName ? `${payload.projectName}:` : '',
      payload.message.substring(0, 200),
    ];

    if (payload.count && payload.count > 1) {
      parts.push(`(${payload.count} occurrences)`);
    }

    return parts.filter(Boolean).join(' ');
  }

  private mapSeverity(
    level: string | undefined,
    configSeverity?: 'critical' | 'error' | 'warning' | 'info',
  ): 'critical' | 'error' | 'warning' | 'info' {
    if (configSeverity) {
      return configSeverity;
    }

    switch ((level || 'error').toLowerCase()) {
      case 'fatal':
      case 'critical':
        return 'critical';
      case 'error':
        return 'error';
      case 'warning':
      case 'warn':
        return 'warning';
      default:
        return 'info';
    }
  }
}
