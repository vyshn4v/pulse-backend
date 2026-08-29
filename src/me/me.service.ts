import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { UpdateMeDto } from './me.dto';

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pineconeService: PineconeService,
  ) {}

  async getProfile(userId: number) {
    let profile = await this.prisma.meProfile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
            leetcodeUsername: true,
            mediumUsername: true,
          },
        },
      },
    });

    if (!profile) {
      profile = await this.prisma.meProfile.create({
        data: {
          userId,
          whoAmI: '',
          goals: '',
          brainBehaviorPrefs: {},
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              avatarUrl: true,
              role: true,
              leetcodeUsername: true,
              mediumUsername: true,
            },
          },
        },
      });
    }

    return profile;
  }

  async updateProfile(userId: number, dto: UpdateMeDto) {
    const userUpdateData: any = {};

    // Extract LeetCode handle
    const incomingLeetCode =
      dto.leetcodeUsername !== undefined
        ? dto.leetcodeUsername
        : dto.brainBehaviorPrefs?.externalHandles?.leetcode;

    if (incomingLeetCode !== undefined) {
      userUpdateData.leetcodeUsername = incomingLeetCode
        .trim()
        .replace(/^https?:\/\/(www\.)?leetcode\.com\/(u\/)?/i, '')
        .replace(/\/.*$/, '');
    }

    // Extract Medium handle
    const incomingMedium =
      dto.mediumUsername !== undefined
        ? dto.mediumUsername
        : dto.brainBehaviorPrefs?.externalHandles?.medium;

    if (incomingMedium !== undefined) {
      userUpdateData.mediumUsername = incomingMedium
        .trim()
        .replace(/^https?:\/\/(www\.)?medium\.com\/@?/i, '')
        .replace(/^@/, '')
        .replace(/\/.*$/, '');
    }

    if (Object.keys(userUpdateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: userUpdateData,
      });
    }

    const profile = await this.prisma.meProfile.upsert({
      where: { userId },
      update: {
        whoAmI: dto.whoAmI ?? undefined,
        goals: dto.goals ?? undefined,
        brainBehaviorPrefs: dto.brainBehaviorPrefs ?? undefined,
      },
      create: {
        userId,
        whoAmI: dto.whoAmI ?? '',
        goals: dto.goals ?? '',
        brainBehaviorPrefs: dto.brainBehaviorPrefs ?? {},
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
            leetcodeUsername: true,
            mediumUsername: true,
          },
        },
      },
    });

    // Incremental background vectorization of User Persona & Goals to Pinecone
    this.pineconeService
      .upsertMemory(userId, {
        id: `persona_${userId}`,
        sourceType: 'persona',
        sourceId: userId,
        title: `[User Persona & Goals] ${profile.whoAmI || 'Engineer Profile'}`,
        content: `Persona & Role: ${profile.whoAmI}\nGoals & Aspirations: ${profile.goals}\nBehavior Preferences: ${JSON.stringify(profile.brainBehaviorPrefs || {})}`,
        timestamp: new Date().toISOString(),
      })
      .catch(() => {});

    if (profile.goals && profile.goals.trim()) {
      this.pineconeService
        .upsertMemory(userId, {
          id: `goals_${userId}`,
          sourceType: 'goals',
          sourceId: userId,
          title: `[Career & Technical Goals] ${profile.whoAmI || 'Core Goals'}`,
          content: profile.goals,
          timestamp: new Date().toISOString(),
        })
        .catch(() => {});
    }

    return profile;
  }
}
