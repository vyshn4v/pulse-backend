import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req: any = context.switchToHttp().getRequest();

    // 1. Check Daemon X-API-Key (Permanent key for deployed monitors & background scripts)
    const apiKey = (req.headers?.['x-api-key'] || req.headers?.['x-pulse-key'] || req.query?.apiKey || req.query?.api_key) as string | undefined;
    const validKeys = [
      'pulse_v3_super_secret_jwt_key_2026',
      process.env.PULSE_API_KEY,
      process.env.JWT_SECRET,
    ].filter(Boolean);

    if (apiKey && validKeys.some((k) => k?.trim() === apiKey.trim())) {
      req.user = { id: 1, email: process.env.ALLOW_LIST_EMAIL || 'vyshnavpcnaravoor@gmail.com' };
      return true;
    }

    // 2. Check Bearer Authorization Header
    const authHeader = req.headers?.authorization as string | undefined;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }

    // 3. Check Cookie
    if (!token && req.headers?.cookie) {
      const match = /(?:^|; )pulse_token=([^;]+)/.exec(req.headers.cookie);
      if (match) token = decodeURIComponent(match[1]);
    }

    // 4. Check Query Parameter (for EventSource SSE)
    if (!token && req.query?.token) {
      token = req.query.token as string;
    }

    if (!token) {
      throw new UnauthorizedException('No authorization token or API key provided');
    }

    try {
      const secret = process.env.JWT_SECRET || 'pulse_v3_super_secret_jwt_key_2026';
      const payload = jwt.verify(token, secret) as any;
      req.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired authorization token');
    }
  }
}
