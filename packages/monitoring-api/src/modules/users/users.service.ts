import { Injectable, ConflictException, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import * as bcrypt from 'bcryptjs';
import type { User, Prisma } from '@prisma/client';

export interface CreateUserDto {
  email: string;
  password: string;
  name: string;
}

export interface UpdateUserDto {
  name?: string;
  avatarUrl?: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async create(data: CreateUserDto): Promise<Omit<User, 'passwordHash'>> {
    // Check if user already exists
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(data.password, 12);

    const user = await this.prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
      },
    });

    this.logger.info('User created', { userId: user.id, email: user.email });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async findById(id: string): Promise<Omit<User, 'passwordHash'> | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) return null;

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  async findByIdOrThrow(id: string): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async update(id: string, data: UpdateUserDto): Promise<Omit<User, 'passwordHash'>> {
    const user = await this.prisma.user.update({
      where: { id },
      data,
    });

    const { passwordHash: _, ...result } = user;
    return result;
  }

  async updateLastLogin(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: new Date() },
    });
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  async list(params: {
    skip?: number;
    take?: number;
    where?: Prisma.UserWhereInput;
    orderBy?: Prisma.UserOrderByWithRelationInput;
  }): Promise<{ data: Omit<User, 'passwordHash'>[]; total: number }> {
    const { skip = 0, take = 20, where, orderBy } = params;

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take,
        where,
        orderBy: orderBy || { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users.map(({ passwordHash: _, ...user }) => user),
      total,
    };
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({ where: { id } });
    this.logger.info('User deleted', { userId: id });
  }
}
