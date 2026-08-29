import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

interface RateLimitRecord {
  timestamps: number[];
}

@Injectable()
export class PublicApiSecurityGuard implements CanActivate {
  private readonly logger = new Logger(PublicApiSecurityGuard.name);
  private static readonly rateLimitMap = new Map<string, RateLimitRecord>();
  private static cleanupTimer: NodeJS.Timeout | null = null;

  constructor() {
    PublicApiSecurityGuard.initCleanup();
  }

  private static initCleanup() {
    if (!PublicApiSecurityGuard.cleanupTimer) {
      PublicApiSecurityGuard.cleanupTimer = setInterval(() => {
        const now = Date.now();
        const windowMs =
          (Number(
            process.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS ||
              process.env.PUBLIC_API_RATE_LIMIT_TTL ||
              60,
          ) || 60) * 1000;

        for (const [key, record] of PublicApiSecurityGuard.rateLimitMap.entries()) {
          record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);
          if (record.timestamps.length === 0) {
            PublicApiSecurityGuard.rateLimitMap.delete(key);
          }
        }
      }, 5 * 60 * 1000); // Cleanup every 5 minutes

      // Prevent timer from holding Node process open if unref is available
      if (PublicApiSecurityGuard.cleanupTimer?.unref) {
        PublicApiSecurityGuard.cleanupTimer.unref();
      }
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<any>();
    const res = http.getResponse<any>();

    // 1. Check API Key (Env Configured)
    const requiredApiKey = (process.env.PUBLIC_API_KEY || '').trim();
    if (requiredApiKey) {
      const providedKey = this.extractApiKey(req);
      if (!providedKey || providedKey !== requiredApiKey) {
        throw new HttpException(
          {
            statusCode: HttpStatus.UNAUTHORIZED,
            error: 'Unauthorized',
            message:
              'Invalid or missing Public API key. Provide via "x-api-key" header, "Authorization: Bearer <key>", or "?apiKey=" query parameter.',
          },
          HttpStatus.UNAUTHORIZED,
        );
      }
    }

    // 2. Check Rate Limit (Env Configured)
    const maxRequests = Number(process.env.PUBLIC_API_RATE_LIMIT_MAX || 60) || 60;
    const windowSeconds =
      Number(
        process.env.PUBLIC_API_RATE_LIMIT_WINDOW_SECONDS ||
          process.env.PUBLIC_API_RATE_LIMIT_TTL ||
          60,
      ) || 60;
    const windowMs = windowSeconds * 1000;

    const clientId = this.getClientIdentifier(req);
    const now = Date.now();

    let record = PublicApiSecurityGuard.rateLimitMap.get(clientId);
    if (!record) {
      record = { timestamps: [] };
      PublicApiSecurityGuard.rateLimitMap.set(clientId, record);
    }

    // Filter out expired timestamps in sliding window
    record.timestamps = record.timestamps.filter((ts) => now - ts < windowMs);

    const currentCount = record.timestamps.length;
    const remaining = Math.max(0, maxRequests - currentCount - 1);
    const resetTimeSeconds = Math.ceil((now + windowMs) / 1000);

    // Set standard rate limit headers on response
    try {
      if (res && typeof res.header === 'function') {
        res.header('X-RateLimit-Limit', maxRequests.toString());
        res.header('X-RateLimit-Remaining', remaining.toString());
        res.header('X-RateLimit-Reset', resetTimeSeconds.toString());
      } else if (res && typeof res.setHeader === 'function') {
        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', remaining.toString());
        res.setHeader('X-RateLimit-Reset', resetTimeSeconds.toString());
      }
    } catch {
      // Ignore header write issues
    }

    if (currentCount >= maxRequests) {
      const oldestInWindow = record.timestamps[0] || now;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((oldestInWindow + windowMs - now) / 1000),
      );

      try {
        if (res && typeof res.header === 'function') {
          res.header('Retry-After', retryAfterSeconds.toString());
        } else if (res && typeof res.setHeader === 'function') {
          res.setHeader('Retry-After', retryAfterSeconds.toString());
        }
      } catch {}

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Public API rate limit exceeded. Max ${maxRequests} requests per ${windowSeconds}s. Please retry in ${retryAfterSeconds}s.`,
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Record request timestamp
    record.timestamps.push(now);
    return true;
  }

  private extractApiKey(req: any): string | null {
    if (!req) return null;

    // Header: x-api-key or x-public-api-key
    const headerKey =
      req.headers?.['x-api-key'] ||
      req.headers?.['x-public-api-key'] ||
      req.headers?.['x-pulse-api-key'];
    if (headerKey && typeof headerKey === 'string') {
      return headerKey.trim();
    }

    // Header: Authorization: Bearer <key> or ApiKey <key>
    const authHeader = req.headers?.['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && ['bearer', 'apikey', 'key'].includes(parts[0].toLowerCase())) {
        return parts[1].trim();
      }
    }

    // Query parameter: ?apiKey=... or ?key=... or ?api_key=...
    const queryKey =
      req.query?.apiKey ||
      req.query?.key ||
      req.query?.api_key ||
      req.query?.['x-api-key'];
    if (queryKey && typeof queryKey === 'string') {
      return queryKey.trim();
    }

    return null;
  }

  private getClientIdentifier(req: any): string {
    if (!req) return 'unknown';

    // 1. Resolve client IP address (handling proxies / Cloudflare headers)
    let clientIp = '127.0.0.1';
    const xForwardedFor = req.headers?.['x-forwarded-for'];
    if (xForwardedFor && typeof xForwardedFor === 'string') {
      clientIp = xForwardedFor.split(',')[0].trim();
    } else if (req.headers?.['x-real-ip'] && typeof req.headers?.['x-real-ip'] === 'string') {
      clientIp = req.headers['x-real-ip'].trim();
    } else if (req.ip) {
      clientIp = req.ip;
    } else if (req.socket?.remoteAddress) {
      clientIp = req.socket.remoteAddress;
    } else if (req.raw?.socket?.remoteAddress) {
      clientIp = req.raw.socket.remoteAddress;
    }

    // 2. If an API key is provided, scope by Key + IP so different visitors with the same key don't block each other
    const apiKey = this.extractApiKey(req);
    if (apiKey) {
      return `key:${apiKey}:ip:${clientIp}`;
    }

    // 3. Fallback to per-IP identifier for public unauthenticated requests
    return `ip:${clientIp}`;
  }
}
