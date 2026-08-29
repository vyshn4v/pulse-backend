import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { getRedisConnectionOpts, BULLMQ_PREFIX } from '../workers/redis-connection';

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  type?: string;
  createdAt: string;
}

@Injectable()
export class MailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);
  private mailQueue: Queue<EmailJobData> | null = null;

  async onModuleInit() {
    const connection = getRedisConnectionOpts();

    try {
      this.mailQueue = new Queue<EmailJobData>('mail-queue', {
        connection,
        prefix: BULLMQ_PREFIX,
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: { count: 200 },
          removeOnFail: { count: 500 },
        },
      });
      this.logger.log('MailService Producer initialized for BullMQ queue.');
    } catch (err: any) {
      this.logger.warn(`Could not initialize BullMQ mail queue producer: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.mailQueue) {
      await this.mailQueue.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Non-Blocking Queued Producer (<2ms instantaneous push)
  // ---------------------------------------------------------------------------

  async enqueueEmail(to: string, subject: string, html: string, type: string = 'general'): Promise<void> {
    const allowList = process.env.ALLOW_LIST_EMAIL || 'vyshnavpcnaravoor@gmail.com';
    const recipient = to || allowList;

    const payload: EmailJobData = {
      to: recipient,
      subject,
      html,
      type,
      createdAt: new Date().toISOString(),
    };

    if (this.mailQueue) {
      await this.mailQueue.add('send-email', payload);
      this.logger.log(`[Mail Producer] Enqueued "${subject}" to Redis mail-queue`);
    } else {
      this.logger.warn(`[Mail Producer] Mail queue offline. Alert payload logged: "${subject}" for ${recipient}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Alert Templates
  // ---------------------------------------------------------------------------

  async sendTokenExpiredAlert(toEmail: string) {
    const subject = '⚠️ PULSE Alert: LinkedIn Auto-Publisher Token Expired';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #12161c; color: #edeae3; padding: 24px; border-radius: 8px; border: 1px solid #262c35;">
        <h2 style="color: #e8a33d; margin-top: 0;">LinkedIn Token Expired</h2>
        <p>Your LinkedIn auto-publisher token has expired or is no longer authorized.</p>
        <p>Any scheduled posts will be moved to the <strong>Review Queue</strong> until you reconnect your LinkedIn account.</p>
        <div style="margin: 20px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/linkedin" style="background: #e8a33d; color: #12161c; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
            Reconnect LinkedIn Account
          </a>
        </div>
        <p style="font-size: 12px; color: #8a8f98; margin-top: 24px;">PULSE Telemetry & Cognitive Control OS</p>
      </div>
    `;
    return this.enqueueEmail(toEmail, subject, html, 'token_expired');
  }

  async sendPostFailedAlert(toEmail: string, postTitle: string, errorReason: string, postId: number) {
    const subject = `⚠️ PULSE Alert: LinkedIn Post #${postId} Moved to Review Queue`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #12161c; color: #edeae3; padding: 24px; border-radius: 8px; border: 1px solid #262c35;">
        <h2 style="color: #e06c75; margin-top: 0;">Scheduled Post Failed</h2>
        <p>A scheduled LinkedIn post could not be published automatically and has been moved to your <strong>Review Queue</strong>.</p>
        <div style="background: #1b2028; border: 1px solid #262c35; border-radius: 6px; padding: 14px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Post:</strong> ${postTitle || `Post #${postId}`}</p>
          <p style="margin: 0; color: #e06c75; font-family: monospace; font-size: 13px;"><strong>Error:</strong> ${errorReason}</p>
        </div>
        <div style="margin: 20px 0;">
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/linkedin" style="background: #e8a33d; color: #12161c; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
            Open Review Queue
          </a>
        </div>
        <p style="font-size: 12px; color: #8a8f98; margin-top: 24px;">PULSE Telemetry & Cognitive Control OS</p>
      </div>
    `;
    return this.enqueueEmail(toEmail, subject, html, 'post_failed');
  }

  async sendPostPublishedAlert(toEmail: string, postTitle: string, postUrl: string, postId: number) {
    const subject = `🚀 PULSE: LinkedIn Post #${postId} Published Live`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #12161c; color: #edeae3; padding: 24px; border-radius: 8px; border: 1px solid #262c35;">
        <h2 style="color: #4ade80; margin-top: 0;">LinkedIn Post Published</h2>
        <p>Your scheduled LinkedIn post has been successfully published live.</p>
        <div style="background: #1b2028; border: 1px solid #262c35; border-radius: 6px; padding: 14px; margin: 16px 0;">
          <p style="margin: 0 0 8px 0;"><strong>Post:</strong> ${postTitle || `Post #${postId}`}</p>
          <p style="margin: 0;"><a href="${postUrl}" style="color: #e8a33d; text-decoration: none; word-break: break-all;">${postUrl}</a></p>
        </div>
        <div style="margin: 20px 0;">
          <a href="${postUrl}" style="background: #0077b5; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
            View Live on LinkedIn →
          </a>
        </div>
        <p style="font-size: 12px; color: #8a8f98; margin-top: 24px;">PULSE Telemetry & Cognitive Control OS</p>
      </div>
    `;
    return this.enqueueEmail(toEmail, subject, html, 'post_published');
  }
}
