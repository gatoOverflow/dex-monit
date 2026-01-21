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
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { AuthService, LoginDto, RegisterDto, TokenResponse } from './auth.service.js';
import type { ApiResponse } from '@dex-monit/observability-contracts';

interface RequestWithUser extends Request {
  user: { id: string; email: string; role: string };
  headers: { authorization?: string; 'user-agent'?: string };
  ip: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new user', description: 'Create a new user account and return authentication tokens' })
  @SwaggerResponse({ status: 201, description: 'User registered successfully' })
  @SwaggerResponse({ status: 400, description: 'Invalid input data' })
  @SwaggerResponse({ status: 409, description: 'Email already exists' })
  async register(@Body() data: RegisterDto): Promise<ApiResponse<TokenResponse>> {
    const result = await this.authService.register(data);
    return { success: true, data: result };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('local'))
  @ApiOperation({ summary: 'Login', description: 'Authenticate with email and password' })
  @ApiBody({ schema: { type: 'object', properties: { email: { type: 'string' }, password: { type: 'string' } }, required: ['email', 'password'] } })
  @SwaggerResponse({ status: 200, description: 'Login successful' })
  @SwaggerResponse({ status: 401, description: 'Invalid credentials' })
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

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh tokens', description: 'Get new access and refresh tokens using a valid refresh token' })
  @ApiBody({ schema: { type: 'object', properties: { refreshToken: { type: 'string' } }, required: ['refreshToken'] } })
  @SwaggerResponse({ status: 200, description: 'Tokens refreshed successfully' })
  @SwaggerResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(
    @Body() body: { refreshToken: string }
  ): Promise<ApiResponse<TokenResponse>> {
    const result = await this.authService.refreshTokens(body.refreshToken);
    return { success: true, data: result };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Logout', description: 'Invalidate the current session token' })
  @SwaggerResponse({ status: 200, description: 'Logged out successfully' })
  @SwaggerResponse({ status: 401, description: 'Unauthorized' })
  async logout(@Request() req: RequestWithUser): Promise<ApiResponse<{ message: string }>> {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      await this.authService.logout(token);
    }
    return { success: true, data: { message: 'Logged out successfully' } };
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Logout all sessions', description: 'Invalidate all active sessions for the current user' })
  @SwaggerResponse({ status: 200, description: 'All sessions logged out' })
  @SwaggerResponse({ status: 401, description: 'Unauthorized' })
  async logoutAll(@Request() req: RequestWithUser): Promise<ApiResponse<{ message: string }>> {
    await this.authService.logoutAll(req.user.id);
    return { success: true, data: { message: 'All sessions logged out' } };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth('JWT')
  @ApiOperation({ summary: 'Get current user', description: 'Get the authenticated user profile' })
  @SwaggerResponse({ status: 200, description: 'User profile returned' })
  @SwaggerResponse({ status: 401, description: 'Unauthorized' })
  async me(@Request() req: RequestWithUser): Promise<ApiResponse<{ id: string; email: string; role: string }>> {
    return { success: true, data: req.user };
  }
}
