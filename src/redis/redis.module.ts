import { Global, Module, OnModuleInit, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

const redisProvider = {
  provide: REDIS_CLIENT,
  useFactory: () => {
    const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
    const rawPrefix = (process.env.REDIS_PREFIX || process.env.REDIS_KEY_PREFIX || 'PULSE').trim();
    const keyPrefix = rawPrefix ? (rawPrefix.endsWith(':') ? rawPrefix : `${rawPrefix}:`) : 'PULSE:';

    const client = new Redis(url, {
      keyPrefix,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      connectTimeout: 15000,
      commandTimeout: 15000,
      keepAlive: 15000,
      enableReadyCheck: false,
      enableOfflineQueue: true,
      connectionName: 'pulse-api-main',
      retryStrategy: (times: number) => {
        return Math.min(times * 300, 3000);
      },
      reconnectOnError: (err: Error) => {
        return true;
      },
    });

    client.on('error', (err) => {
      // Gracefully log connection warning without crashing
      const msg = err && err.message ? err.message : String(err);
      if (!msg.includes('ETIMEDOUT') && !msg.includes('ECONNREFUSED')) {
        console.warn('[Redis] Connection notice:', msg);
      }
    });

    client.on('connect', () => {
      console.log('[Redis] Connection established to Redis server.');
    });

    client.on('reconnecting', () => {
      // Reconnecting silently
    });

    return client;
  },
};

@Global()
@Module({
  providers: [redisProvider],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit {
  private readonly logger = new Logger(RedisModule.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit() {
    const maxMemory = process.env.REDIS_MAX_MEMORY || '30mb';
    const clientTimeout = process.env.REDIS_CLIENT_TIMEOUT || '300';

    try {
      if (this.redis.status === 'wait') {
        await this.redis.connect();
      }
      this.logger.log('[Redis] Connected successfully.');

      // Enforce strict memory ceiling and connection pruning for 1GB RAM / 1 vCPU server stability
      try {
        await this.redis.config('SET', 'maxmemory', maxMemory);
        await this.redis.config('SET', 'maxmemory-policy', 'noeviction');
        await this.redis.config('SET', 'timeout', clientTimeout); // Close idle connections after timeout
        await this.redis.config('SET', 'tcp-keepalive', '60');
        this.logger.log(`[Redis] Enforced maxmemory=${maxMemory}, maxmemory-policy=noeviction & client-timeout=${clientTimeout}s.`);
      } catch (cfgErr: any) {
        this.logger.warn(`[Redis] CONFIG command note (managed Redis may restrict CONFIG): ${cfgErr?.message || cfgErr}`);
      }
    } catch (err: any) {
      this.logger.warn(`[Redis] Initial connect deferred or failed: ${err?.message || err}`);
    }
  }
}
