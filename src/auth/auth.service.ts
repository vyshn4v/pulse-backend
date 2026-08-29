import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as jwt from 'jsonwebtoken';
import type { GoogleProfile } from './google-oauth';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async validateOrCreateUser(profile: GoogleProfile) {
    const email = profile?.email;
    if (!email) {
      throw new UnauthorizedException('No email found on Google profile');
    }

    const allow = process.env.ALLOW_LIST_EMAIL || 'vyshnavpcnaravoor@gmail.com';
    if (email.toLowerCase() !== allow.toLowerCase()) {
      console.warn(`[Auth] Rejected login attempt from unauthorized email: ${email}`);
      throw new UnauthorizedException(`Email ${email} is not authorized for PULSE`);
    }

    const googleId = profile.id;
    // Upsert on email so user creation and profile updates are idempotent
    const user = await this.prisma.user.upsert({
      where: { email },
      update: {
        googleId,
        name: profile.name ?? '',
        avatarUrl: profile.picture ?? '',
      },
      create: {
        googleId,
        email,
        name: profile.name ?? '',
        avatarUrl: profile.picture ?? '',
        role: 'admin',
      },
    });

    return user;
  }

  signToken(payload: { sub: number; email: string; name?: string }) {
    const secret = process.env.JWT_SECRET || 'pulse_v3_super_secret_jwt_key_2026';
    return jwt.sign(payload, secret, { expiresIn: '7d' });
  }

  async getUserById(id: number) {
    return this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        role: true,
        createdAt: true,
      },
    });
  }
}
