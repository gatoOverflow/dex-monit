/**
 * Monitoring API - Main Entry Point
 *
 * Internal observability platform for error monitoring and log management.
 */

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Use our custom logger from the SDK
    bufferLogs: true,
  });

  // Enable CORS for the frontend
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // API prefix - all routes will be under /api
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);

  const port = process.env['PORT'] || 3000;
  await app.listen(port);

  console.log(
    `🚀 Monitoring API is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
