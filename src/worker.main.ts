import './config/env-loader';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './mail/mail.module';
import { WorkersModule } from './workers/workers.module';

@Module({
  imports: [PrismaModule, RedisModule, MailModule, WorkersModule],
})
class StandaloneWorkerAppModule {}

async function bootstrap() {
  console.log('[PULSE v3] Initializing Standalone BullMQ Worker Process...');
  const app = await NestFactory.createApplicationContext(StandaloneWorkerAppModule);
  console.log('[PULSE v3] Standalone Worker Process running. Listening on [linkedin-queue] & [mail-queue].');

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('[PULSE v3] Shutting down worker process gracefully...');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap();
