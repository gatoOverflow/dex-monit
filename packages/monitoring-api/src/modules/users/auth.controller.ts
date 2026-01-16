import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Get,
  Headers,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService, LoginDto, RegisterDto, TokenResponse } from './auth.service.js';
import type { ApiResponse } from '@dex-monit/observability-contracts';

interface RequestWithUser extends Request {
  user: { id: string; email: string; role: string };
  headers: { authorization?: string; 'user-agent'?: string };
  ip: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /auth/register
   * Register a new user
   */
  @Post('register')
  async register(@Body() data: RegisterDto): Promise<ApiResponse<TokenResponse>> {
    const result = await this.authService.register(data);
    return { success: true, data: result };
  }

  /**
   * POST /auth/login
   * Login with email and password
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('local'))
  async login(
    @Request() req: RequestWithUser,
    @Headers('user-agent') userAgent?: string
  ): Promise<ApiResponse<TokenResponse>> {
    const result = await this.authService.login(
      req.user as TokenResponse['user'],
      userAgent,
      req.ip
    );
    return { success: true, data: result };
  }

  /**
   * POST /auth/refresh
   * Refresh access token
   */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() body: { refreshToken: string }
  ): Promise<ApiResponse<TokenResponse>> {
    const result = await this.authService.refreshTokens(body.refreshToken);
    return { success: true, data: result };
  }

  /**
   * POST /auth/logout
   * Logout current session
   */
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  async logout(@Request() req: RequestWithUser): Promise<ApiResponse<{ message: string }>> {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await this.authService.logout(token);
    }
    return { success: true, data: { message: 'Logged out successfully' } };
  }

  /**
   * POST /auth/logout-all
   * Logout all sessions
   */
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  async logoutAll(@Request() req: RequestWithUser): Promise<ApiResponse<{ message: string }>> {
    await this.authService.logoutAll(req.user.id);
    return { success: true, data: { message: 'All sessions logged out' } };
  }

  /**
   * GET /auth/me
   * Get current user
   */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async me(@Request() req: RequestWithUser): Promise<ApiResponse<{ id: string; email: string; role: string }>> {
    return { success: true, data: req.user };
  }
}
