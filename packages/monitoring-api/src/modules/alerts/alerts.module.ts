import { Module } from '@nestjs/common';
import { AlertRulesController } from './alert-rules.controller.js';
import { AlertRulesService } from './alert-rules.service.js';
import { AlertsService } from './alerts.service.js';
import { NotificationService } from './notification.service.js';
import { EmailService } from './email.service.js';
import { PagerDutyService, TeamsService, TelegramService } from './channels/index.js';

@Module({
  controllers: [AlertRulesController],
  providers: [
    AlertRulesService,
    AlertsService,
    NotificationService,
    EmailService,
    PagerDutyService,
    TeamsService,
    TelegramService,
  ],
  exports: [
    AlertRulesService,
    AlertsService,
    NotificationService,
    EmailService,
    PagerDutyService,
    TeamsService,
    TelegramService,
  ],
})
export class AlertsModule {}
