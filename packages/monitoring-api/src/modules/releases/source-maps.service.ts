import { Injectable, NotFoundException, Inject } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Logger } from '@dex-monit/observability-logger';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { SourceMap } from '@prisma/client';

export interface UploadSourceMapDto {
  projectId: string;
  releaseId?: string;
  filename: string;
  content: Buffer | string;
}

export interface SourceMapFile {
  version: number;
  sources: string[];
  sourcesContent?: string[];
  mappings: string;
  names: string[];
}

@Injectable()
export class SourceMapsService {
  private uploadDir: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(Logger) private readonly logger: Logger
  ) {
    this.uploadDir = process.env['SOURCEMAP_DIR'] || '/tmp/sourcemaps';
  }

  async upload(data: UploadSourceMapDto): Promise<SourceMap> {
    const content = typeof data.content === 'string' 
      ? Buffer.from(data.content) 
      : data.content;
    
    // Calculate file hash
    const fileHash = crypto.createHash('sha256').update(content).digest('hex');

    // Ensure upload directory exists
    const projectDir = path.join(this.uploadDir, data.projectId);
    await fs.mkdir(projectDir, { recursive: true });

    // Save file
    const filePath = path.join(projectDir, `${fileHash}.map`);
    await fs.writeFile(filePath, content);

    // Check for existing
    const existing = await this.prisma.sourceMap.findFirst({
      where: {
        projectId: data.projectId,
        filename: data.filename,
        fileHash,
      },
    });

    if (existing) {
      this.logger.info('Source map already exists', {
        sourceMapId: existing.id,
        filename: data.filename,
      });
      return existing;
    }

    // Create record
    const sourceMap = await this.prisma.sourceMap.create({
      data: {
        projectId: data.projectId,
        releaseId: data.releaseId,
        filename: data.filename,
        sourceMapUrl: filePath,
        fileHash,
      },
    });

    this.logger.info('Source map uploaded', {
      sourceMapId: sourceMap.id,
      filename: data.filename,
    });

    return sourceMap;
  }

  async findByFilename(
    projectId: string,
    filename: string
  ): Promise<SourceMap | null> {
    return this.prisma.sourceMap.findFirst({
      where: {
        projectId,
        filename,
      },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findByRelease(releaseId: string): Promise<SourceMap[]> {
    return this.prisma.sourceMap.findMany({
      where: { releaseId },
      orderBy: { filename: 'asc' },
    });
  }

  async getContent(id: string): Promise<SourceMapFile> {
    const sourceMap = await this.prisma.sourceMap.findUnique({
      where: { id },
    });

    if (!sourceMap) {
      throw new NotFoundException('Source map not found');
    }

    const content = await fs.readFile(sourceMap.sourceMapUrl, 'utf-8');
    return JSON.parse(content) as SourceMapFile;
  }

  async delete(id: string): Promise<void> {
    const sourceMap = await this.prisma.sourceMap.findUnique({
      where: { id },
    });

    if (sourceMap) {
      // Delete file
      try {
        await fs.unlink(sourceMap.sourceMapUrl);
      } catch {
        // File may not exist
      }

      // Delete record
      await this.prisma.sourceMap.delete({ where: { id } });
    }

    this.logger.info('Source map deleted', { sourceMapId: id });
  }

  /**
   * Apply source map to a stack frame
   * TODO: Implement actual source map parsing and mapping
   */
  async mapStackFrame(
    projectId: string,
    filename: string,
    line: number,
    column: number
  ): Promise<{ file: string; line: number; column: number; name?: string } | null> {
    const sourceMap = await this.findByFilename(projectId, filename);
    
    if (!sourceMap) {
      return null;
    }

    // TODO: Use source-map library to actually map the position
    // For now, return null (no mapping)
    
    return null;
  }
}
