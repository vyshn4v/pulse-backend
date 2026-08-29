import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AuthService } from './auth.service';
import { GoogleEnabledGuard } from './google-enabled.guard';
import {
  buildAuthUrl,
  callbackUrl,
  exchangeCode,
  fetchProfile,
  isGoogleConfigured,
  newState,
} from './google-oauth';

type HttpRequest = {
  headers?: {
    authorization?: string;
    cookie?: string;
  };
  user?: any;
};

type HttpReply = {
  code?: (statusCode: number) => HttpReply;
  header?: (name: string, value: string) => HttpReply;
  redirect: (url: string, code?: number) => unknown;
  send?: (body: unknown) => unknown;
};

function getCookieOptions(): string {
  const isProd = process.env.NODE_ENV === 'production' || process.env.FRONTEND_URL?.startsWith('https://');
  if (isProd) {
    return 'HttpOnly; Path=/; Max-Age=604800; SameSite=None; Secure';
  }
  return 'HttpOnly; Path=/; Max-Age=604800; SameSite=Lax';
}

function readPulseToken(req: HttpRequest): string | undefined {
  const authHeader = req.headers?.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);

  const cookieHeader = req.headers?.cookie;
  if (!cookieHeader) return undefined;

  const match = /(?:^|; )pulse_token=([^;]+)/.exec(cookieHeader);
  return match ? decodeURIComponent(match[1]) : undefined;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('google')
  @UseGuards(GoogleEnabledGuard)
  googleAuth(@Res() res: HttpReply, @Query('source') source?: string) {
    const stateParam = source === 'mobile' ? `mobile_${newState()}` : newState();
    return res.redirect(buildAuthUrl(stateParam), 302);
  }

  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: HttpReply,
  ) {
    const isMobile = state?.startsWith('mobile_');
    const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
    if (error || !code) {
      console.warn('[Auth] Callback reached with error or missing code:', { error, hasCode: !!code });
      if (isMobile) {
        return res.redirect(`pulse://auth/callback?status=failed`, 302);
      }
      return res.redirect(`${frontend}/?auth=failed`, 302);
    }

    console.log(`[Auth] Callback code received (len=${code.length}); exchanging with callbackUrl=${callbackUrl()}`);

    try {
      const tokenData = await exchangeCode(code);
      const profile = await fetchProfile(tokenData.access_token);
      const user = await this.authService.validateOrCreateUser(profile);
      const token = this.authService.signToken({
        sub: user.id,
        email: user.email,
        name: user.name,
      });

      res.header?.(
        'Set-Cookie',
        `pulse_token=${encodeURIComponent(token)}; ${getCookieOptions()}`,
      );

      if (isMobile) {
        return res.redirect(
          `pulse://auth/callback?token=${encodeURIComponent(token)}&status=success&name=${encodeURIComponent(user.name || '')}&email=${encodeURIComponent(user.email || '')}`,
          302,
        );
      }

      return res.redirect(`${frontend}/?auth=success`, 302);
    } catch (err) {
      console.error('[Auth] Google OAuth callback failed:', err?.message || err);
      if (isMobile) {
        return res.redirect(`pulse://auth/callback?status=failed`, 302);
      }
      return res.redirect(`${frontend}/?auth=failed`, 302);
    }
  }

  @Get('logout')
  logout(@Req() _req: HttpRequest, @Res() res: HttpReply) {
    const isProd = process.env.NODE_ENV === 'production' || process.env.FRONTEND_URL?.startsWith('https://');
    const clearCookie = isProd
      ? 'pulse_token=; HttpOnly; Path=/; Max-Age=0; SameSite=None; Secure'
      : 'pulse_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';
    res.header?.('Set-Cookie', clearCookie);
    return res.send?.({ msg: 'logged out' });
  }

  @Get('me')
  async me(@Req() req: HttpRequest) {
    const token = readPulseToken(req);
    if (!token) return null;

    try {
      const secret = process.env.JWT_SECRET || 'pulse_v3_super_secret_jwt_key_2026';
      const payload = jwt.verify(token, secret) as any;
      const user = await this.authService.getUserById(payload.sub);
      return user || { id: payload.sub, email: payload.email, name: payload.name };
    } catch {
      return null;
    }
  }

  @Post('google/verify')
  async verifyGoogleToken(@Body('idToken') idToken: string) {
    if (!idToken) {
      throw new UnauthorizedException('No ID token provided');
    }
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    if (!res.ok) {
      throw new UnauthorizedException('Invalid or expired Google ID Token');
    }
    const payload = (await res.json()) as any;
    const profile = {
      id: String(payload.sub || ''),
      email: String(payload.email || ''),
      name: String(payload.name || payload.email || 'User'),
      picture: String(payload.picture || ''),
    };
    const user = await this.authService.validateOrCreateUser(profile);
    const token = this.authService.signToken({
      sub: user.id,
      email: user.email,
      name: user.name,
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  @Post('session')
  async directSession(@Body('apiKey') apiKey: string, @Body('email') email?: string) {
    const configuredApiKey = process.env.PULSE_API_KEY || process.env.JWT_SECRET || 'pulse_v3_super_secret_jwt_key_2026';
    if (!apiKey || (apiKey !== configuredApiKey && apiKey !== process.env.JWT_SECRET)) {
      throw new UnauthorizedException('Invalid master API key');
    }
    const targetEmail = email || process.env.ALLOW_LIST_EMAIL || 'vyshnavpcnaravoor@gmail.com';
    const profile = {
      id: '1',
      email: targetEmail,
      name: targetEmail.split('@')[0],
      picture: '',
    };
    const user = await this.authService.validateOrCreateUser(profile);
    const token = this.authService.signToken({
      sub: user.id,
      email: user.email,
      name: user.name,
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  @Get('available')
  available() {
    return { enabled: isGoogleConfigured() };
  }
}
