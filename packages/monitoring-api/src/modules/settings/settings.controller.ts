import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SettingsService, SlackConfig, EmailConfig, WebhookConfig } from './settings.service.js';
import type { ApiResponse } from '@dex-monit/observability-contracts';

@Controller('settings')
@UseGuards(AuthGuard('jwt'))
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * GET /settings/:teamId
   * Get all settings for a team
   */
  @Get(':teamId')
  async getSettings(
    @Param('teamId') teamId: string,
  ): Promise<ApiResponse<{ slack?: SlackConfig; email?: EmailConfig; webhook?: WebhookConfig }>> {
    const settings = await this.settingsService.getSettings(teamId);
    
    // Mask sensitive data
    if (settings.email?.smtpPassword) {
      settings.email.smtpPassword = '••••••••';
    }
    
    return { success: true, data: settings };
  }

  /**
   * POST /settings/:teamId/slack
   * Save Slack configuration
   */
  @Post(':teamId/slack')
  async saveSlackConfig(
    @Param('teamId') teamId: string,
    @Body() config: SlackConfig,
  ): Promise<ApiResponse<{ message: string }>> {
    await this.settingsService.saveSlackConfig(teamId, config);
    return { success: true, data: { message: 'Slack configuration saved' } };
  }

  /**
   * POST /settings/:teamId/slack/test
   * Test Slack notification
   */
  @Post(':teamId/slack/test')
  async testSlack(
    @Body() config: SlackConfig,
  ): Promise<ApiResponse<{ success: boolean; error?: string }>> {
    const result = await this.settingsService.testSlack(config);
    return { success: result.success, data: result };
  }

  /**
   * POST /settings/:teamId/email
   * Save Email configuration
   */
  @Post(':teamId/email')
  async saveEmailConfig(
    @Param('teamId') teamId: string,
    @Body() config: EmailConfig,
  ): Promise<ApiResponse<{ message: string }>> {
    await this.settingsService.saveEmailConfig(teamId, config);
    return { success: true, data: { message: 'Email configuration saved' } };
  }

  /**
   * POST /settings/:teamId/email/test
   * Test Email notification
   */
  @Post(':teamId/email/test')
  async testEmail(
    @Body() body: { config: EmailConfig; toEmail: string },
    @Req() req: any,
  ): Promise<ApiResponse<{ success: boolean; error?: string }>> {
    // Use the requester's email if not provided
    const toEmail = body.toEmail || req.user?.email;
    if (!toEmail) {
      return { success: false, data: { success: false, error: 'No recipient email provided' } };
    }
    
    const result = await this.settingsService.testEmail(body.config, toEmail);
    return { success: result.success, data: result };
  }

  /**
   * POST /settings/:teamId/webhook
   * Save Webhook configuration
   */
  @Post(':teamId/webhook')
  async saveWebhookConfig(
    @Param('teamId') teamId: string,
    @Body() config: WebhookConfig,
  ): Promise<ApiResponse<{ message: string }>> {
    await this.settingsService.saveWebhookConfig(teamId, config);
    return { success: true, data: { message: 'Webhook configuration saved' } };
  }

  /**
   * POST /settings/:teamId/webhook/test
   * Test Webhook
   */
  @Post(':teamId/webhook/test')
  async testWebhook(
    @Body() config: WebhookConfig,
  ): Promise<ApiResponse<{ success: boolean; error?: string }>> {
    const result = await this.settingsService.testWebhook(config);
    return { success: result.success, data: result };
  }
}
