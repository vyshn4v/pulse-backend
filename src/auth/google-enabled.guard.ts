import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { isGoogleConfigured } from './google-oauth';

@Injectable()
export class GoogleEnabledGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const res = context.switchToHttp().getResponse();
    if (!isGoogleConfigured()) {
      const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
      res.redirect(`${frontend}/?auth=not_configured`, 302);
      return false;
    }
    return true;
  }
}
