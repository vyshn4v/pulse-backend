import { Module } from '@nestjs/common';
import { AppUsageController } from './app-usage.controller';
import { AppUsageService } from './app-usage.service';
import { AppUsageCron } from './app-usage.cron';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AppUsageController],
  providers: [AppUsageService, AppUsageCron],
  exports: [AppUsageService],
})
export class AppUsageModule {}
