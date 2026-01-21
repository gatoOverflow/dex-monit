/**
 * Monitoring API - Main Entry Point
 *
 * Internal observability platform for error monitoring and log management.
 */

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app/app.module.js';
import * as express from 'express';

// Configuration
const MAX_BODY_SIZE = process.env['MAX_BODY_SIZE'] || '5mb';
const CORS_ORIGINS = process.env['CORS_ORIGINS']?.split(',') || true;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Use our custom logger from the SDK
    bufferLogs: true,
  });

  // Body parser limits
  app.use(express.json({ limit: MAX_BODY_SIZE }));
  app.use(express.urlencoded({ limit: MAX_BODY_SIZE, extended: true }));

  // Enable CORS with configuration
  app.enableCors({
    origin: CORS_ORIGINS,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Dex-Key',
      'X-Request-ID',
    ],
    maxAge: 86400, // 24 hours
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // API prefix - all routes will be under /api
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  // Swagger API Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Dex Monitoring API')
    .setDescription(`
      ## Overview
      Dex Monitoring is an internal observability platform for error monitoring, log management, and performance tracking.

      ## Authentication
      Most endpoints require authentication via JWT Bearer token. Use the \`/api/auth/login\` endpoint to obtain a token.

      For SDK ingestion endpoints, use the \`X-Dex-Key\` header with your project API key.

      ## Rate Limits
      - Standard API: 1000 requests/minute
      - Ingest API: 10000 events/minute per project
    `)
    .setVersion('1.0.0')
    .setContact('Dex Team', '', 'support@dex-monitoring.io')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token',
      },
      'JWT',
    )
    .addApiKey(
      {
        type: 'apiKey',
        in: 'header',
        name: 'X-Dex-Key',
        description: 'Project API Key for SDK ingestion',
      },
      'X-Dex-Key',
    )
    .addTag('Auth', 'Authentication and user management')
    .addTag('Teams', 'Team management')
    .addTag('Projects', 'Project management')
    .addTag('Issues', 'Issue tracking and management')
    .addTag('Events', 'Error events')
    .addTag('Logs', 'Log management')
    .addTag('Traces', 'HTTP trace monitoring')
    .addTag('Sessions', 'User session tracking')
    .addTag('Alerts', 'Alert rules and notifications')
    .addTag('Ingest', 'SDK data ingestion endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    customSiteTitle: 'Dex Monitoring API Docs',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
  });

  const port = process.env['PORT'] || 3000;
  await app.listen(port);

  console.log(
    `🚀 Monitoring API is running on: http://localhost:${port}/${globalPrefix}`,
  );
  console.log(
    `📚 API Documentation available at: http://localhost:${port}/docs`,
  );
}

bootstrap();
