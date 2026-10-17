import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RateLimitService } from './common/rate-limit/rate-limit.service';
import { setupSwagger } from './common/swagger/setup-swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  app.setGlobalPrefix('api', {
    exclude: ['health', 'api-docs', 'api-docs-json'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:5173');
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
      } else if (origin.startsWith('chrome-extension://')) {
        // MV3 扩展 Side Panel / fetch（阶段 C）
        callback(null, true);
      } else if (corsOrigin && origin === corsOrigin) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    credentials: true,
    exposedHeaders: ['Content-Disposition'],
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: false,
      contentSecurityPolicy: false,
    }),
  );

  const uploadsPath = join(
    process.cwd(),
    '..',
    'intelligent_document_backend',
    'uploads',
  );
  app.useStaticAssets(uploadsPath, { prefix: '/uploads' });

  setupSwagger(app, config.get<number>('PORT', 3000));

  await app.init();

  const rateLimitService = app.get(RateLimitService);
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.use('/api', rateLimitService.getApiLimiter());

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  console.log(`[Nest] Server running on http://localhost:${port}`);
  console.log(`[Nest] Swagger: http://localhost:${port}/api-docs`);
}
void bootstrap();
