import { Module } from '@nestjs/common';
import { BrainController } from './brain.controller';
import { BrainService } from './brain.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { AppUsageModule } from '../app-usage/app-usage.module';
import { LlmProviderService } from './services/llm-provider.service';
import { ActivityFocusSpecialist } from './specialists/activity-focus.specialist';
import { LeetCodeDsaSpecialist } from './specialists/leetcode-dsa.specialist';
import { CareerPipelineSpecialist } from './specialists/career-pipeline.specialist';
import { LinkedInBrandSpecialist } from './specialists/linkedin-brand.specialist';
import { MasterOracleSynthesizer } from './synthesizers/master-oracle.synthesizer';

@Module({
  imports: [PrismaModule, AuthModule, MailModule, AppUsageModule],
  controllers: [BrainController],
  providers: [
    BrainService,
    LlmProviderService,
    ActivityFocusSpecialist,
    LeetCodeDsaSpecialist,
    CareerPipelineSpecialist,
    LinkedInBrandSpecialist,
    MasterOracleSynthesizer,
  ],
  exports: [BrainService],
})
export class BrainModule {}
