import { Injectable, NotFoundException, UnauthorizedException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import * as crypto from 'crypto';
import type { ApiKey, ApiKeyType } from '@prisma/client';

export interface CreateApiKeyDto {
  projectId: string;
  name: string;
  type?: ApiKeyType;
  scopes?: string[];
  createdById?: string;
  expiresAt?: Date;
}

export interface ApiKeyWithSecret extends ApiKey {
  secretKey: string; // Only returned on creation
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {}

  /**
   * Generate a new API key
   */
  private generateKey(): { key: string; hash: string; prefix: string } {
    const key = `dex_${crypto.randomBytes(32).toString('hex')}`;
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const prefix = key.substring(0, 12);
    return { key, hash, prefix };
  }

  /**
   * Hash a key for lookup
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  async create(data: CreateApiKeyDto): Promise<ApiKeyWithSecret> {
    const { key, hash, prefix } = this.generateKey();

    const apiKey = await this.prisma.apiKey.create({
      data: {
        projectId: data.projectId,
        name: data.name,
        keyHash: hash,
        keyPrefix: prefix,
        type: data.type || 'DSN',
        scopes: data.scopes || ['ingest'],
        createdById: data.createdById,
        expiresAt: data.expiresAt,
      },
    });

    this.logger.info('API key created', {
      apiKeyId: apiKey.id,
      projectId: data.projectId,
      name: data.name,
    });

    // Return the secret key only on creation
    return {
      ...apiKey,
      secretKey: key,
    };
  }

  async findByKey(key: string): Promise<ApiKey | null> {
    const hash = this.hashKey(key);
    return this.prisma.apiKey.findUnique({
      where: { keyHash: hash },
      include: { project: true },
    });
  }

  async validateKey(key: string, requiredScopes: string[] = []): Promise<ApiKey> {
    const apiKey = await this.findByKey(key);

    if (!apiKey) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!apiKey.isActive) {
      throw new UnauthorizedException('API key is disabled');
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw new UnauthorizedException('API key has expired');
    }

    // Check scopes
    if (requiredScopes.length > 0) {
      const hasAllScopes = requiredScopes.every((scope) =>
        apiKey.scopes.includes(scope)
      );
      if (!hasAllScopes) {
        throw new UnauthorizedException('API key does not have required scopes');
      }
    }

    // Update last used timestamp
    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return apiKey;
  }

  async findByProject(projectId: string): Promise<ApiKey[]> {
    return this.prisma.apiKey.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<ApiKey | null> {
    return this.prisma.apiKey.findUnique({ where: { id } });
  }

  async revoke(id: string): Promise<ApiKey> {
    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data: { isActive: false },
    });

    this.logger.info('API key revoked', { apiKeyId: id });

    return apiKey;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.apiKey.delete({ where: { id } });
    this.logger.info('API key deleted', { apiKeyId: id });
  }

  /**
   * Generate a DSN (Data Source Name) URL for SDK configuration
   */
  getDsn(key: string, projectId: string): string {
    const baseUrl = process.env['API_URL'] || 'http://localhost:3000/api';
    return `${baseUrl}/ingest?key=${key}&project=${projectId}`;
  }
}
