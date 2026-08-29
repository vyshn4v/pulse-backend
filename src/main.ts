import './config/env-loader';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
  );

  // Enable CORS for Frontend SPA, Mobile Android App, and PC Desktop Client
  app.enableCors({
    origin: (origin, callback) => {
      // Allow all valid origins (browser requests with origin or non-browser tools)
      callback(null, true);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Origin',
      'X-Requested-With',
      'Cookie',
      'Cache-Control',
    ],
    exposedHeaders: ['Set-Cookie'],
  });

  // Global prefix for all REST APIs
  app.setGlobalPrefix('api');

  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;
  await app.listen(port, '0.0.0.0');
  console.log(`[PULSE v3] Server listening on port ${port} (API prefix: /api)`);
}

bootstrap();
