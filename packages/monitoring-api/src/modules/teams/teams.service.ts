import { Injectable, NotFoundException, ConflictException, ForbiddenException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import type { Team, TeamMember, TeamMemberRole } from '@prisma/client';

export interface CreateTeamDto {
  name: string;
  slug: string;
  description?: string;
}

export interface UpdateTeamDto {
  name?: string;
  description?: string;
  avatarUrl?: string;
}

export interface AddMemberDto {
  userId: string;
  role?: TeamMemberRole;
}

export type TeamWithMembers = Team & {
  members: (TeamMember & { user: { id: string; name: string; email: string; avatarUrl: string | null } })[];
};

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  async create(data: CreateTeamDto, creatorId: string): Promise<Team> {
    // Check for duplicate slug
    const existing = await this.prisma.team.findUnique({
      where: { slug: data.slug },
    });

    if (existing) {
      throw new ConflictException('Team with this slug already exists');
    }

    // Create team with creator as owner
    const team = await this.prisma.team.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        members: {
          create: {
            userId: creatorId,
            role: 'OWNER',
          },
        },
      },
    });

    this.logger.info('Team created', { teamId: team.id, name: team.name });

    return team;
  }

  async findById(id: string): Promise<TeamWithMembers | null> {
    return this.prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
  }

  async findByIdOrThrow(id: string): Promise<TeamWithMembers> {
    const team = await this.findById(id);
    if (!team) {
      throw new NotFoundException('Team not found');
    }
    return team;
  }

  async findBySlug(slug: string): Promise<TeamWithMembers | null> {
    return this.prisma.team.findUnique({
      where: { slug },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });
  }

  async findByUser(userId: string): Promise<Team[]> {
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId },
      include: {
        team: {
          include: {
            _count: {
              select: {
                projects: true,
                members: true,
              },
            },
          },
        },
      },
    });

    return memberships.map((m) => m.team);
  }

  async update(id: string, data: UpdateTeamDto): Promise<Team> {
    const team = await this.prisma.team.update({
      where: { id },
      data,
    });

    this.logger.info('Team updated', { teamId: id });

    return team;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.team.delete({ where: { id } });
    this.logger.info('Team deleted', { teamId: id });
  }

  async addMember(teamId: string, data: AddMemberDto): Promise<TeamMember> {
    // Check if user is already a member
    const existing = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: {
          teamId,
          userId: data.userId,
        },
      },
    });

    if (existing) {
      throw new ConflictException('User is already a member of this team');
    }

    const member = await this.prisma.teamMember.create({
      data: {
        teamId,
        userId: data.userId,
        role: data.role || 'MEMBER',
      },
    });

    this.logger.info('Team member added', { teamId, userId: data.userId });

    return member;
  }

  async updateMemberRole(teamId: string, userId: string, role: TeamMemberRole): Promise<TeamMember> {
    const member = await this.prisma.teamMember.update({
      where: {
        teamId_userId: { teamId, userId },
      },
      data: { role },
    });

    this.logger.info('Team member role updated', { teamId, userId, role });

    return member;
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    // Check if this is the last owner
    const member = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: { teamId, userId },
      },
    });

    if (member?.role === 'OWNER') {
      const ownerCount = await this.prisma.teamMember.count({
        where: { teamId, role: 'OWNER' },
      });

      if (ownerCount <= 1) {
        throw new ForbiddenException('Cannot remove the last owner of the team');
      }
    }

    await this.prisma.teamMember.delete({
      where: {
        teamId_userId: { teamId, userId },
      },
    });

    this.logger.info('Team member removed', { teamId, userId });
  }

  async getMemberRole(teamId: string, userId: string): Promise<TeamMemberRole | null> {
    const member = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: { teamId, userId },
      },
    });

    return member?.role || null;
  }

  async isMember(teamId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.teamMember.findUnique({
      where: {
        teamId_userId: { teamId, userId },
      },
    });

    return !!member;
  }

  async isAdminOrOwner(teamId: string, userId: string): Promise<boolean> {
    const role = await this.getMemberRole(teamId, userId);
    return role === 'OWNER' || role === 'ADMIN';
  }
}
