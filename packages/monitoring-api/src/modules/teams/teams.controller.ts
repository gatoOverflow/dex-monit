import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { TeamsService, CreateTeamDto, UpdateTeamDto, AddMemberDto, TeamWithMembers } from './teams.service.js';
import type { ApiResponse } from '@dex-monit/observability-contracts';
import type { Team, TeamMember, TeamMemberRole } from '@prisma/client';

interface RequestWithUser extends Request {
  user: { id: string };
}

@Controller('teams')
@UseGuards(AuthGuard('jwt'))
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  /**
   * POST /teams
   * Create a new team
   */
  @Post()
  async create(
    @Body() data: CreateTeamDto,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<Team>> {
    const team = await this.teamsService.create(data, req.user.id);
    return { success: true, data: team };
  }

  /**
   * GET /teams
   * List teams for current user
   */
  @Get()
  async list(@Request() req: RequestWithUser): Promise<ApiResponse<Team[]>> {
    const teams = await this.teamsService.findByUser(req.user.id);
    return { success: true, data: teams };
  }

  /**
   * GET /teams/:id
   * Get a single team
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<TeamWithMembers>> {
    // Check membership
    const isMember = await this.teamsService.isMember(id, req.user.id);
    if (!isMember) {
      throw new ForbiddenException('Not a member of this team');
    }

    const team = await this.teamsService.findByIdOrThrow(id);
    return { success: true, data: team };
  }

  /**
   * PUT /teams/:id
   * Update a team
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() data: UpdateTeamDto,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<Team>> {
    // Check admin/owner role
    const isAdmin = await this.teamsService.isAdminOrOwner(id, req.user.id);
    if (!isAdmin) {
      throw new ForbiddenException('Only team admins can update the team');
    }

    const team = await this.teamsService.update(id, data);
    return { success: true, data: team };
  }

  /**
   * DELETE /teams/:id
   * Delete a team
   */
  @Delete(':id')
  async delete(
    @Param('id') id: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<{ message: string }>> {
    // Check owner role
    const role = await this.teamsService.getMemberRole(id, req.user.id);
    if (role !== 'OWNER') {
      throw new ForbiddenException('Only team owners can delete the team');
    }

    await this.teamsService.delete(id);
    return { success: true, data: { message: 'Team deleted' } };
  }

  /**
   * POST /teams/:id/members
   * Add a member to the team
   */
  @Post(':id/members')
  async addMember(
    @Param('id') id: string,
    @Body() data: AddMemberDto,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<TeamMember>> {
    // Check admin/owner role
    const isAdmin = await this.teamsService.isAdminOrOwner(id, req.user.id);
    if (!isAdmin) {
      throw new ForbiddenException('Only team admins can add members');
    }

    const member = await this.teamsService.addMember(id, data);
    return { success: true, data: member };
  }

  /**
   * PUT /teams/:id/members/:userId
   * Update a member's role
   */
  @Put(':id/members/:userId')
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() data: { role: TeamMemberRole },
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<TeamMember>> {
    // Check owner role (only owners can change roles)
    const role = await this.teamsService.getMemberRole(id, req.user.id);
    if (role !== 'OWNER') {
      throw new ForbiddenException('Only team owners can change member roles');
    }

    const member = await this.teamsService.updateMemberRole(id, userId, data.role);
    return { success: true, data: member };
  }

  /**
   * DELETE /teams/:id/members/:userId
   * Remove a member from the team
   */
  @Delete(':id/members/:userId')
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Request() req: RequestWithUser
  ): Promise<ApiResponse<{ message: string }>> {
    // Users can remove themselves, admins/owners can remove others
    if (userId !== req.user.id) {
      const isAdmin = await this.teamsService.isAdminOrOwner(id, req.user.id);
      if (!isAdmin) {
        throw new ForbiddenException('Only team admins can remove members');
      }
    }

    await this.teamsService.removeMember(id, userId);
    return { success: true, data: { message: 'Member removed' } };
  }
}
