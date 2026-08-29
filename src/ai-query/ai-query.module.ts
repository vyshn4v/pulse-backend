import { Module } from '@nestjs/common';
import { AiQueryController } from './ai-query.controller';
import { AiQueryService } from './ai-query.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AiQueryController],
  providers: [AiQueryService],
  exports: [AiQueryService],
})
export class AiQueryModule {}
