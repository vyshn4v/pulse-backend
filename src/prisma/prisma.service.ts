import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '../../prisma/client-v11';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const rawUrl = process.env.DATABASE_URL || '';
    const poolLimit = parseInt(
      process.env.DB_CONNECTION_LIMIT || process.env.DATABASE_CONNECTION_LIMIT || '2',
      10,
    );
    const poolTimeout = parseInt(process.env.DB_POOL_TIMEOUT || '10', 10);
    const connectTimeout = parseInt(process.env.DB_CONNECT_TIMEOUT || '10', 10);

    let configuredUrl = rawUrl;
    if (configuredUrl) {
      const urlObj = new URL(
        configuredUrl.startsWith('postgresql://') || configuredUrl.startsWith('postgres://')
          ? configuredUrl
          : `postgresql://${configuredUrl}`,
      );

      // Enforce connection_limit if not already explicitly customized in URL
      if (!urlObj.searchParams.has('connection_limit')) {
        urlObj.searchParams.set('connection_limit', poolLimit.toString());
      }
      if (!urlObj.searchParams.has('pool_timeout')) {
        urlObj.searchParams.set('pool_timeout', poolTimeout.toString());
      }
      if (!urlObj.searchParams.has('connect_timeout')) {
        urlObj.searchParams.set('connect_timeout', connectTimeout.toString());
      }

      configuredUrl = urlObj.toString();
    }

    super({
      datasources: {
        db: {
          url: configuredUrl,
        },
      },
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'error' },
              { emit: 'event', level: 'warn' },
            ]
          : [{ emit: 'event', level: 'error' }],
    });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log(
        `[PostgreSQL] Connected with connection pool size limit = ${
          process.env.DB_CONNECTION_LIMIT || process.env.DATABASE_CONNECTION_LIMIT || '2'
        }`,
      );
    } catch (err: any) {
      this.logger.error(`[PostgreSQL] Connection failed: ${err?.message || err}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('[PostgreSQL] Disconnected and connection pool closed.');
  }
}
