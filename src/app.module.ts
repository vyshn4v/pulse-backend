import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './mail/mail.module';
import { MeModule } from './me/me.module';
import { ActivityModule } from './activity/activity.module';
import { JobModule } from './job-pipeline/job.module';
import { HRModule } from './hr-details/hr.module';
import { LeetCodeModule } from './leetcode/leetcode.module';
import { LinkedInModule } from './linkedin/linkedin.module';
import { WorkersModule } from './workers/workers.module';
import { PerformanceModule } from './performance/performance.module';
import { BrainModule } from './brain/brain.module';
import { AiQueryModule } from './ai-query/ai-query.module';
import { PineconeModule } from './pinecone/pinecone.module';
import { AppUsageModule } from './app-usage/app-usage.module';
import { SystemMonitorModule } from './system-monitor/system-monitor.module';
import { MediumModule } from './medium/medium.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    PineconeModule,
    AuthModule,
    MailModule,
    MeModule,
    ActivityModule,
    JobModule,
    HRModule,
    LeetCodeModule,
    LinkedInModule,
    MediumModule,
    ProjectsModule,
    WorkersModule,
    PerformanceModule,
    BrainModule,
    AiQueryModule,
    AppUsageModule,
    SystemMonitorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
