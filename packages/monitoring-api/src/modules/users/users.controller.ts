import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UsersService, UpdateUserDto } from './users.service.js';
import type { ApiResponse, PaginatedResponse } from '@dex-monit/observability-contracts';
import type { User } from '@prisma/client';

interface RequestWithUser extends Request {
  user: { id: string; email: string; role: string };
}

type SafeUser = Omit<User, 'passwordHash'>;

@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * GET /users
   * List all users (admin only)
   */
  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string
  ): Promise<ApiResponse<PaginatedResponse<SafeUser>>> {
    const pageNum = parseInt(page || '1', 10);
    const size = parseInt(pageSize || '20', 10);

    const where = search
      ? {
          OR: [
            { email: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : undefined;

    const { data, total } = await this.usersService.list({
      skip: (pageNum - 1) * size,
      take: size,
      where,
    });

    return {
      success: true,
      data: {
        data,
        meta: {
          page: pageNum,
          pageSize: size,
          total,
          totalPages: Math.ceil(total / size),
        },
      },
    };
  }

  /**
   * GET /users/:id
   * Get a single user
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse<SafeUser>> {
    const user = await this.usersService.findByIdOrThrow(id);
    return { success: true, data: user };
  }

  /**
   * PUT /users/:id
   * Update a user (self or admin)
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateUserDto,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<SafeUser>> {
    // Only allow users to update themselves or admins to update anyone
    if (req.user.id !== id && req.user.role !== 'ADMIN') {
      throw new Error('Unauthorized');
    }

    const user = await this.usersService.update(id, data);
    return { success: true, data: user };
  }

  /**
   * DELETE /users/:id
   * Delete a user (admin only)
   */
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<{ message: string }>> {
    if (req.user.role !== 'ADMIN') {
      throw new Error('Unauthorized');
    }

    await this.usersService.delete(id);
    return { success: true, data: { message: 'User deleted' } };
  }
}
