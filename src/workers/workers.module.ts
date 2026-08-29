import { Module } from '@nestjs/common';
import { MailWorker } from './mail.worker';
import { LinkedInWorker } from './linkedin.worker';
import { PrismaModule } from '../prisma/prisma.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, MailModule],
  providers: [MailWorker, LinkedInWorker],
  exports: [MailWorker, LinkedInWorker],
})
export class WorkersModule {}
