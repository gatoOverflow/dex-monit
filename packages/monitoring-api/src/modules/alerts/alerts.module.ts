import { Module } from '@nestjs/common';
import { AlertRulesController } from './alert-rules.controller.js';
import { AlertRulesService } from './alert-rules.service.js';
import { AlertsService } from './alerts.service.js';
import { NotificationService } from './notification.service.js';

@Module({
  controllers: [AlertRulesController],
  providers: [AlertRulesService, AlertsService, NotificationService],
  exports: [AlertRulesService, AlertsService, NotificationService],
})
export class AlertsModule {}
