import { Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from './users.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import { v4 as uuidv4 } from 'uuid';
import type { User } from '@prisma/client';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Omit<User, 'passwordHash'>;
}

export interface LoginDto {
  email: string;
  password: string;
}

export interface RegisterDto {
  email: string;
  password: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async validateUser(email: string, password: string): Promise<Omit<User, 'passwordHash'> | null> {
    const user = await this.usersService.findByEmail(email);
    
    if (!user || !user.isActive) {
      return null;
    }

    const isValid = await this.usersService.validatePassword(user, password);
    
    if (!isValid) {
      return null;
    }

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async login(user: Omit<User, 'passwordHash'>, userAgent?: string, ipAddress?: string): Promise<TokenResponse> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = this.jwtService.sign(payload);
    const refreshToken = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Store session
    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: accessToken,
        refreshToken,
        expiresAt,
        userAgent,
        ipAddress,
      },
    });

    // Update last login
    await this.usersService.updateLastLogin(user.id);

    this.logger.info('User logged in', { userId: user.id, email: user.email });

    return {
      accessToken,
      refreshToken,
      expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
      user,
    };
  }

  async register(data: RegisterDto): Promise<TokenResponse> {
    const user = await this.usersService.create(data);
    return this.login(user as Omit<User, 'passwordHash'>);
  }

  async refreshTokens(refreshToken: string): Promise<TokenResponse> {
    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findByIdOrThrow(session.userId);

    // Delete old session
    await this.prisma.session.delete({
      where: { id: session.id },
    });

    // Create new session
    return this.login(user as Omit<User, 'passwordHash'>);
  }

  async logout(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { token },
    });

    this.logger.info('User logged out');
  }

  async logoutAll(userId: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { userId },
    });

    this.logger.info('All sessions logged out', { userId });
  }

  async validateToken(token: string): Promise<JwtPayload | null> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      
      // Check if session exists
      const session = await this.prisma.session.findUnique({
        where: { token },
      });

      if (!session || session.expiresAt < new Date()) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }
}
