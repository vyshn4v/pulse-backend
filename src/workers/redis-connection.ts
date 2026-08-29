export const BULLMQ_PREFIX = process.env.REDIS_PREFIX || process.env.BULLMQ_PREFIX || 'PULSE';

export function getRedisConnectionOpts() {
  const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  try {
    const parsed = new URL(redisUrl);
    return {
      host: parsed.hostname || '127.0.0.1',
      port: Number(parsed.port) || 6379,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      maxRetriesPerRequest: null,
      connectTimeout: 15000,
      commandTimeout: 15000,
      keepAlive: 15000,
      enableReadyCheck: false,
      enableOfflineQueue: true,
      retryStrategy(times: number) {
        // Exponential backoff up to 3 seconds
        return Math.min(times * 300, 3000);
      },
      reconnectOnError(err: Error) {
        return true;
      },
    };
  } catch {
    return {
      host: '127.0.0.1',
      port: 6379,
      maxRetriesPerRequest: null,
      connectTimeout: 15000,
      commandTimeout: 15000,
      keepAlive: 15000,
      enableReadyCheck: false,
      enableOfflineQueue: true,
      retryStrategy(times: number) {
        return Math.min(times * 300, 3000);
      },
    };
  }
}
