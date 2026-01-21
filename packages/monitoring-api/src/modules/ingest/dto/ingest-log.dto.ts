import {
  IsString,
  IsOptional,
  IsObject,
  IsIn,
  IsDateString,
  MaxLength,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Severity } from '@dex-monit/observability-contracts';

export class IngestLogDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  id?: string;

  @IsDateString()
  timestamp: string;

  @IsIn(['debug', 'info', 'warning', 'error', 'fatal'])
  level: Severity;

  @IsString()
  @MaxLength(10000)
  message: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  project?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  environment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  serverName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  logger?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  requestId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transactionId?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  tags?: Record<string, string>;
}

export class IngestLogsBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => IngestLogDto)
  @ArrayMaxSize(1000, { message: 'Maximum 1000 logs per batch' })
  logs: IngestLogDto[];
}
