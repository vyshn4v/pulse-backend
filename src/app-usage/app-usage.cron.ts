import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AppUsageService } from './app-usage.service';

@Injectable()
export class AppUsageCron {
  private readonly logger = new Logger(AppUsageCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appUsageService: AppUsageService,
  ) {}

  /**
   * Nightly 21:00 PM (IST) Screen Time Digest Cron
   * Aggregates daily telemetry and queues the screen time digest email.
   */
  @Cron('0 21 * * *', {
    name: 'nightly-screentime-digest',
    timeZone: 'Asia/Kolkata',
  })
  async handleNightlyScreenTimeDigest() {
    this.logger.log('Executing automated 21:00 PM Developer Screen Time Digest cron...');

    const users = await this.prisma.user.findMany({
      select: { id: true, email: true },
    });

    for (const user of users) {
      try {
        const today = await this.appUsageService.getTodaySummary(user.id);
        if (today.totalSeconds > 0) {
          await this.appUsageService.sendDailyDigestEmail(user.id);
          this.logger.log(`21:00 digest queued for user #${user.id} (${user.email})`);
        }
      } catch (err: any) {
        this.logger.warn(`Failed to process 21:00 digest for user #${user.id}: ${err.message}`);
      }
    }
  }
}
