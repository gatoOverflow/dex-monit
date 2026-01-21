import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  IsIn,
  IsDateString,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { Severity } from '@dex-monit/observability-contracts';

class StackFrameDto {
  @IsString()
  @MaxLength(500)
  filename: string;

  @IsString()
  @MaxLength(200)
  function: string;

  @IsInt()
  @Min(0)
  @Max(1000000)
  lineno: number;

  @IsInt()
  @Min(0)
  @Max(10000)
  colno: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  context?: string[];
}

class ExceptionDetailsDto {
  @IsString()
  @MaxLength(200)
  type: string;

  @IsString()
  @MaxLength(2000)
  value: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StackFrameDto)
  stacktrace?: StackFrameDto[];
}

class BreadcrumbDto {
  @IsDateString()
  timestamp: string;

  @IsString()
  @MaxLength(100)
  category: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @IsOptional()
  @IsIn(['debug', 'info', 'warning', 'error', 'fatal'])
  level?: Severity;

  @IsOptional()
  @IsIn(['default', 'http', 'navigation', 'error', 'debug', 'query'])
  type?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

class SdkInfoDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(50)
  version: string;
}

export class IngestErrorDto {
  @IsString()
  @MaxLength(100)
  eventId: string;

  @IsDateString()
  timestamp: string;

  @IsOptional()
  @IsIn(['debug', 'info', 'warning', 'error', 'fatal'])
  level?: Severity;

  @IsString()
  @MaxLength(50)
  platform: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => SdkInfoDto)
  sdk?: SdkInfoDto;

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
  release?: string;

  @IsString()
  @MaxLength(5000)
  message: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExceptionDetailsDto)
  exception?: ExceptionDetailsDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BreadcrumbDto)
  breadcrumbs?: BreadcrumbDto[];

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
  contexts?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fingerprint?: string[];
}
