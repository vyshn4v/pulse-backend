import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import * as nodemailer from 'nodemailer';
import { getRedisConnectionOpts, BULLMQ_PREFIX } from './redis-connection';
import { EmailJobData } from '../mail/mail.service';

@Injectable()
export class MailWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailWorker.name);
  private worker: Worker<EmailJobData> | null = null;
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    this.initTransporter();
  }

  private initTransporter() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT) || 587;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      try {
        this.transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
        });
        this.logger.log(`SMTP Mail Transport configured for Worker with host: ${host}`);
      } catch (err: any) {
        this.logger.warn(`Could not initialize SMTP transport in Worker: ${err.message}`);
      }
    }
  }

  async onModuleInit() {
    // If running in standalone worker process or worker-threads mode
    const connection = getRedisConnectionOpts();

    try {
      this.worker = new Worker<EmailJobData>(
        'mail-queue',
        async (job: Job<EmailJobData>) => {
          this.logger.log(`[Mail Consumer Thread] Processing job #${job.id}: "${job.data.subject}" to ${job.data.to}`);
          await this.deliverEmail(job.data.to, job.data.subject, job.data.html);
        },
        {
          connection,
          prefix: BULLMQ_PREFIX,
          concurrency: 2,
          useWorkerThreads: true, // Run in isolated Worker Thread
        },
      );

      this.worker.on('completed', (job) => {
        this.logger.log(`[Mail Consumer Thread] Successfully delivered email job #${job.id}`);
      });

      this.worker.on('failed', (job, err) => {
        this.logger.error(`[Mail Consumer Thread] Job #${job?.id} failed on attempt ${job?.attemptsMade}: ${err.message}`);
      });

      this.logger.log('Mail Worker Consumer initialized on isolated Worker Thread.');
    } catch (err: any) {
      this.logger.warn(`Could not initialize Mail Worker: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
  }

  private async deliverEmail(to: string, subject: string, html: string): Promise<boolean> {
    this.logger.warn(`[WORKER EMAIL DISPATCH] To: ${to} | Subject: ${subject}`);

    if (!this.transporter) {
      this.logger.log(`[WORKER SIMULATION] SMTP not configured. Recorded telemetry for "${subject}"`);
      return true;
    }

    const from = process.env.SMTP_FROM || `"PULSE OS" <${process.env.SMTP_USER || 'noreply@pulse.internal'}>`;
    await this.transporter.sendMail({
      from,
      to,
      subject,
      html,
    });
    return true;
  }
}
