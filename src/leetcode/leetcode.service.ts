import { Injectable, NotFoundException, BadRequestException, Logger, Inject, Optional } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UpdateLeetCodeConfigDto, CreateManualSubmissionDto } from './leetcode.dto';

import { PineconeService } from '../pinecone/pinecone.service';

export interface LeetCodeScrapedProfile {
  username: string;
  realName?: string;
  avatarUrl?: string;
  ranking?: number | null;
  reputation?: number;
  countryName?: string;
  company?: string;
  school?: string;
  aboutMe?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  twitterUrl?: string;
  // Contest stats
  contestRating?: number | null;
  contestGlobalRanking?: number | null;
  contestTopPercentage?: number | null;
  contestsAttended?: number;
  contestBadge?: string | null;
  // Question & Solved stats
  totalQuestions: number;
  totalEasy: number;
  totalMedium: number;
  totalHard: number;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  acceptanceRate: number;
  easyAcceptanceRate?: number;
  mediumAcceptanceRate?: number;
  hardAcceptanceRate?: number;
  // Skills breakdown
  skills: {
    fundamental: Array<{ name: string; slug: string; count: number }>;
    intermediate: Array<{ name: string; slug: string; count: number }>;
    advanced: Array<{ name: string; slug: string; count: number }>;
  };
  // Languages breakdown
  languages: Array<{ language: string; count: number }>;
  // Badges
  badges: Array<{ id: string; name: string; icon: string; displayName?: string; category?: string }>;
  // Activity calendar & streaks
  submissionCalendar: Record<string, number>;
  currentStreak: number;
  longestStreak: number;
  totalSubmissionsCount: number;
  topTopics: Array<{ topic: string; count: number }>;
  lastScrapedAt: string;
}

@Injectable()
export class LeetCodeService {
  private readonly logger = new Logger(LeetCodeService.name);
  private profileCache: Map<number, LeetCodeScrapedProfile> = new Map();
  private problemMetaCache: Map<string, { difficulty: string; topics: string[] }> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pineconeService: PineconeService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
  ) {}

  private cleanHandle(raw?: string): string {
    if (!raw) return '';
    return raw
      .trim()
      .replace(/^https?:\/\/(www\.)?leetcode\.com\/(u\/)?/i, '')
      .replace(/\/.*$/, '')
      .trim();
  }

  // Parse LeetCode submissionCalendar
  private parseSubmissionCalendar(rawCalendar: any): {
    calendar: Record<string, number>;
    currentStreak: number;
    longestStreak: number;
    totalSubmissions: number;
  } {
    let rawObj: Record<string, number> = {};

    if (typeof rawCalendar === 'string') {
      try {
        rawObj = JSON.parse(rawCalendar);
      } catch {
        rawObj = {};
      }
    } else if (typeof rawCalendar === 'object' && rawCalendar !== null) {
      rawObj = rawCalendar;
    }

    const calendar: Record<string, number> = {};
    let totalSubmissions = 0;

    Object.entries(rawObj).forEach(([key, count]) => {
      let dateStr = '';
      const numKey = Number(key);

      if (!isNaN(numKey)) {
        const ms = numKey > 1e11 ? numKey : numKey * 1000;
        dateStr = new Date(ms).toISOString().slice(0, 10);
      } else if (key.match(/^\d{4}-\d{2}-\d{2}$/)) {
        dateStr = key;
      }

      if (dateStr) {
        calendar[dateStr] = (calendar[dateStr] || 0) + Number(count || 0);
        totalSubmissions += Number(count || 0);
      }
    });

    const sortedDates = Object.keys(calendar).sort();
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    for (let i = 0; i < sortedDates.length; i++) {
      if (i === 0) {
        tempStreak = 1;
      } else {
        const prev = new Date(sortedDates[i - 1]);
        const curr = new Date(sortedDates[i]);
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 3600 * 24));

        if (diffDays === 1) {
          tempStreak++;
        } else if (diffDays > 1) {
          tempStreak = 1;
        }
      }
      if (tempStreak > longestStreak) {
        longestStreak = tempStreak;
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    let checkDate = calendar[todayStr] ? today : calendar[yesterdayStr] ? yesterday : null;

    if (checkDate) {
      while (true) {
        const ds = checkDate.toISOString().slice(0, 10);
        if (calendar[ds] && calendar[ds] > 0) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }

    return { calendar, currentStreak, longestStreak, totalSubmissions };
  }

  async getConfig(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { leetcodeUsername: true },
    });

    let username = this.cleanHandle(user?.leetcodeUsername || '');

    if (!username) {
      const me = await this.prisma.meProfile.findUnique({
        where: { userId },
        select: { brainBehaviorPrefs: true },
      });
      const prefs: any = me?.brainBehaviorPrefs || {};
      username = this.cleanHandle(prefs?.externalHandles?.leetcode || '');
    }

    return { username };
  }

  async updateConfig(userId: number, dto: UpdateLeetCodeConfigDto) {
    const cleanUser = this.cleanHandle(dto.username);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { leetcodeUsername: cleanUser },
      select: { leetcodeUsername: true },
    });

    if (cleanUser) {
      this.scrapeLeetCodeProfile(userId, cleanUser).catch((err) =>
        this.logger.warn(`LeetCode background scrape warning: ${err.message}`),
      );
    }

    return { username: updated.leetcodeUsername };
  }

  async getStats(userId: number) {
    const config = await this.getConfig(userId);
    const username = config.username;

    // 1. Check in-memory cache
    let cached = this.profileCache.get(userId);

    // 2. Check persistent Redis cache if memory is cold
    if (!cached && this.redis) {
      try {
        const redisData = await this.redis.get(`leetcode:profile:${userId}`);
        if (redisData) {
          cached = JSON.parse(redisData);
          this.profileCache.set(userId, cached!);
        }
      } catch (err: any) {
        this.logger.warn(`Redis get cache error: ${err.message}`);
      }
    }

    // 3. If cache is still empty and username is configured, scrape in background
    if (!cached && username) {
      this.scrapeLeetCodeProfile(userId, username).catch((err) =>
        this.logger.warn(`Background cold-start LeetCode scrape warning: ${err.message}`),
      );
    }

    // 4. Database submissions
    const submissions = await this.prisma.leetCodeSubmission.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
    });

    const easyCount =
      cached?.easySolved !== undefined && cached.easySolved > 0
        ? cached.easySolved
        : submissions.filter((s) => s.difficulty.toLowerCase() === 'easy').length;

    const mediumCount =
      cached?.mediumSolved !== undefined && cached.mediumSolved > 0
        ? cached.mediumSolved
        : submissions.filter((s) => s.difficulty.toLowerCase() === 'medium').length;

    const hardCount =
      cached?.hardSolved !== undefined && cached.hardSolved > 0
        ? cached.hardSolved
        : submissions.filter((s) => s.difficulty.toLowerCase() === 'hard').length;

    const totalSolved =
      cached?.totalSolved !== undefined && cached.totalSolved > 0
        ? cached.totalSolved
        : easyCount + mediumCount + hardCount || submissions.length;

    // Topics list
    const topicMap: Record<string, number> = {};
    submissions.forEach((s) => {
      s.topics.forEach((t) => {
        topicMap[t] = (topicMap[t] || 0) + 1;
      });
    });

    const dbTopics = Object.entries(topicMap)
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    const topTopics = cached?.topTopics && cached.topTopics.length > 0 ? cached.topTopics : dbTopics;

    let submissionCalendar = cached?.submissionCalendar || {};
    submissions.forEach((s) => {
      const ds = new Date(s.timestamp).toISOString().slice(0, 10);
      if (!submissionCalendar[ds]) {
        submissionCalendar[ds] = 1;
      }
    });

    const activeDaysCount = Object.keys(submissionCalendar).length;

    return {
      username,
      realName: cached?.realName || '',
      avatarUrl: cached?.avatarUrl || '',
      ranking: cached?.ranking || null,
      reputation: cached?.reputation || 0,
      countryName: cached?.countryName || '',
      company: cached?.company || '',
      school: cached?.school || '',
      aboutMe: cached?.aboutMe || '',
      githubUrl: cached?.githubUrl || '',
      linkedinUrl: cached?.linkedinUrl || '',
      // Contest
      contestRating: cached?.contestRating || null,
      contestGlobalRanking: cached?.contestGlobalRanking || null,
      contestTopPercentage: cached?.contestTopPercentage || null,
      contestsAttended: cached?.contestsAttended || 0,
      contestBadge: cached?.contestBadge || null,
      // Problems
      totalQuestions: cached?.totalQuestions || 3300,
      totalEasy: cached?.totalEasy || 830,
      totalMedium: cached?.totalMedium || 1740,
      totalHard: cached?.totalHard || 760,
      totalSolved,
      easyCount,
      mediumCount,
      hardCount,
      easySolved: easyCount,
      mediumSolved: mediumCount,
      hardSolved: hardCount,
      acceptanceRate: cached?.acceptanceRate || 0,
      easyAcceptanceRate: cached?.easyAcceptanceRate || 0,
      mediumAcceptanceRate: cached?.mediumAcceptanceRate || 0,
      hardAcceptanceRate: cached?.hardAcceptanceRate || 0,
      // Skills & Languages
      skills: cached?.skills || { fundamental: [], intermediate: [], advanced: [] },
      languages: cached?.languages || [],
      badges: cached?.badges || [],
      // Calendar
      activeDaysCount,
      currentStreak: cached?.currentStreak || 0,
      longestStreak: cached?.longestStreak || 0,
      totalSubmissionsCount: cached?.totalSubmissionsCount || submissions.length,
      submissionCalendar,
      topTopics,
      recentSubmissions: submissions.slice(0, 30),
      lastScrapedAt: cached?.lastScrapedAt || null,
    };
  }

  async findAllSubmissions(userId: number, difficulty?: string, search?: string) {
    const where: any = { userId };
    if (difficulty && difficulty !== 'all') {
      where.difficulty = { equals: difficulty, mode: 'insensitive' };
    }

    let submissions = await this.prisma.leetCodeSubmission.findMany({
      where,
      orderBy: { timestamp: 'desc' },
    });

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      submissions = submissions.filter(
        (s) =>
          s.title.toLowerCase().includes(q) ||
          s.titleSlug.toLowerCase().includes(q) ||
          s.notes?.toLowerCase().includes(q) ||
          s.language.toLowerCase().includes(q) ||
          s.topics.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return submissions;
  }

  // Helper to resolve accurate problem difficulty & topic tags
  private async resolveProblemDifficulty(titleSlug: string): Promise<{ difficulty: string; topics: string[] }> {
    if (this.problemMetaCache.has(titleSlug)) {
      return this.problemMetaCache.get(titleSlug)!;
    }

    try {
      const query = {
        query: `
          query getQuestionDetails($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              difficulty
              topicTags {
                name
              }
            }
          }
        `,
        variables: { titleSlug },
      };

      const res = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query),
        signal: AbortSignal.timeout(3500),
      });

      if (res.ok) {
        const qJson = await res.json();
        const q = qJson.data?.question;
        if (q && q.difficulty) {
          const result = {
            difficulty: q.difficulty,
            topics: Array.isArray(q.topicTags) ? q.topicTags.map((t: any) => t.name) : ['Algorithm'],
          };
          this.problemMetaCache.set(titleSlug, result);
          return result;
        }
      }
    } catch {}

    const fallback = { difficulty: 'Easy', topics: ['Algorithm'] };
    return fallback;
  }

  async scrapeLeetCodeProfile(userId: number, forceUsername?: string) {
    let username = this.cleanHandle(forceUsername);

    if (!username) {
      const config = await this.getConfig(userId);
      username = config.username;
    }

    if (!username) {
      throw new BadRequestException(
        'No LeetCode handle configured. Please add your LeetCode handle in the Me profile section first.',
      );
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { leetcodeUsername: username },
    });

    const scrapedData: Partial<LeetCodeScrapedProfile> = {
      username,
      totalQuestions: 3300,
      totalEasy: 830,
      totalMedium: 1740,
      totalHard: 760,
      totalSolved: 0,
      easySolved: 0,
      mediumSolved: 0,
      hardSolved: 0,
      acceptanceRate: 0,
      skills: { fundamental: [], intermediate: [], advanced: [] },
      languages: [],
      badges: [],
      topTopics: [],
      submissionCalendar: {},
      currentStreak: 0,
      longestStreak: 0,
      totalSubmissionsCount: 0,
      lastScrapedAt: new Date().toISOString(),
    };

    let scrapedRecentList: any[] = [];
    let rawCalendarData: any = null;
    let success = false;

    // 1. Comprehensive LeetCode GraphQL Queries
    try {
      const compositeQuery = {
        query: `
          query getFullLeetCodeProfile($username: String!) {
            allQuestionsCount {
              difficulty
              count
            }
            matchedUser(username: $username) {
              username
              githubUrl
              twitterUrl
              linkedinUrl
              submissionCalendar
              profile {
                realName
                userAvatar
                ranking
                reputation
                countryName
                company
                school
                aboutMe
              }
              submitStatsGlobal {
                acSubmissionNum {
                  difficulty
                  count
                  submissions
                }
                totalSubmissionNum {
                  difficulty
                  count
                  submissions
                }
              }
              submitStats: submitStatsGlobal {
                acSubmissionNum {
                  difficulty
                  count
                  submissions
                }
                totalSubmissionNum {
                  difficulty
                  count
                  submissions
                }
              }
              badges {
                id
                name
                icon
                displayName
                category
              }
              tagProblemCounts {
                fundamental {
                  tagName
                  tagSlug
                  problemsSolved
                }
                intermediate {
                  tagName
                  tagSlug
                  problemsSolved
                }
                advanced {
                  tagName
                  tagSlug
                  problemsSolved
                }
              }
              languageProblemCount {
                languageName
                problemsSolved
              }
            }
            userContestRanking(username: $username) {
              attendedContestsCount
              rating
              globalRanking
              totalParticipants
              topPercentage
              badge {
                name
              }
            }
            recentAcSubmissionList(username: $username, limit: 50) {
              id
              title
              titleSlug
              timestamp
            }
          }
        `,
        variables: { username },
      };

      const response = await fetch('https://leetcode.com/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Referer: `https://leetcode.com/u/${username}/`,
        },
        body: JSON.stringify(compositeQuery),
        signal: AbortSignal.timeout(9000),
      });

      if (response.ok) {
        const json = await response.json();
        const matched = json.data?.matchedUser;
        const contest = json.data?.userContestRanking;
        const allQuestions = json.data?.allQuestionsCount || [];
        scrapedRecentList = json.data?.recentAcSubmissionList || [];

        if (matched) {
          success = true;
          rawCalendarData = matched.submissionCalendar;
          const profile = matched.profile || {};
          const submitStats = matched.submitStatsGlobal || matched.submitStats || {};
          const acStats = submitStats.acSubmissionNum || [];
          const totalStats = submitStats.totalSubmissionNum || [];

          // Parse questions available
          allQuestions.forEach((q: any) => {
            if (q.difficulty === 'All') scrapedData.totalQuestions = q.count;
            if (q.difficulty === 'Easy') scrapedData.totalEasy = q.count;
            if (q.difficulty === 'Medium') scrapedData.totalMedium = q.count;
            if (q.difficulty === 'Hard') scrapedData.totalHard = q.count;
          });

          // Parse solved count
          acStats.forEach((st: any) => {
            if (st.difficulty === 'All') scrapedData.totalSolved = Number(st.count);
            if (st.difficulty === 'Easy') scrapedData.easySolved = Number(st.count);
            if (st.difficulty === 'Medium') scrapedData.mediumSolved = Number(st.count);
            if (st.difficulty === 'Hard') scrapedData.hardSolved = Number(st.count);
          });

          // Acceptance rates
          const allAc = acStats.find((s: any) => s.difficulty === 'All')?.submissions || 0;
          const allTotal = totalStats.find((s: any) => s.difficulty === 'All')?.submissions || 0;
          if (allTotal > 0) {
            scrapedData.acceptanceRate = Math.round((allAc / allTotal) * 1000) / 10;
          }

          const easyAc = acStats.find((s: any) => s.difficulty === 'Easy')?.submissions || 0;
          const easyTotal = totalStats.find((s: any) => s.difficulty === 'Easy')?.submissions || 0;
          if (easyTotal > 0) {
            scrapedData.easyAcceptanceRate = Math.round((easyAc / easyTotal) * 1000) / 10;
          }

          const medAc = acStats.find((s: any) => s.difficulty === 'Medium')?.submissions || 0;
          const medTotal = totalStats.find((s: any) => s.difficulty === 'Medium')?.submissions || 0;
          if (medTotal > 0) {
            scrapedData.mediumAcceptanceRate = Math.round((medAc / medTotal) * 1000) / 10;
          }

          const hardAc = acStats.find((s: any) => s.difficulty === 'Hard')?.submissions || 0;
          const hardTotal = totalStats.find((s: any) => s.difficulty === 'Hard')?.submissions || 0;
          if (hardTotal > 0) {
            scrapedData.hardAcceptanceRate = Math.round((hardAc / hardTotal) * 1000) / 10;
          }

          scrapedData.realName = profile.realName || '';
          scrapedData.avatarUrl = profile.userAvatar || '';
          scrapedData.ranking = profile.ranking || null;
          scrapedData.reputation = profile.reputation || 0;
          scrapedData.countryName = profile.countryName || '';
          scrapedData.company = profile.company || '';
          scrapedData.school = profile.school || '';
          scrapedData.aboutMe = profile.aboutMe || '';
          scrapedData.githubUrl = matched.githubUrl || '';
          scrapedData.linkedinUrl = matched.linkedinUrl || '';

          // Contest ranking
          if (contest) {
            scrapedData.contestRating = contest.rating ? Math.round(contest.rating) : null;
            scrapedData.contestGlobalRanking = contest.globalRanking || null;
            scrapedData.contestTopPercentage = contest.topPercentage || null;
            scrapedData.contestsAttended = contest.attendedContestsCount || 0;
            scrapedData.contestBadge = contest.badge?.name || null;
          }

          // Badges
          scrapedData.badges = (matched.badges || []).map((b: any) => ({
            id: b.id,
            name: b.name,
            icon: b.icon,
            displayName: b.displayName || b.name,
            category: b.category,
          }));

          // Skills
          const tagCounts = matched.tagProblemCounts || {};
          const fund = (tagCounts.fundamental || []).map((t: any) => ({
            name: t.tagName,
            slug: t.tagSlug,
            count: t.problemsSolved,
          }));
          const inter = (tagCounts.intermediate || []).map((t: any) => ({
            name: t.tagName,
            slug: t.tagSlug,
            count: t.problemsSolved,
          }));
          const adv = (tagCounts.advanced || []).map((t: any) => ({
            name: t.tagName,
            slug: t.tagSlug,
            count: t.problemsSolved,
          }));

          scrapedData.skills = {
            fundamental: fund,
            intermediate: inter,
            advanced: adv,
          };

          const allSkills = [...fund, ...inter, ...adv].sort((a, b) => b.count - a.count);
          scrapedData.topTopics = allSkills.map((s) => ({ topic: s.name, count: s.count })).slice(0, 16);

          scrapedData.languages = (matched.languageProblemCount || []).map((l: any) => ({
            language: l.languageName,
            count: l.problemsSolved,
          }));
        }
      }
    } catch (err: any) {
      this.logger.warn(`GraphQL comprehensive scraper warning: ${err.message}. Attempting fallback mirrors...`);
    }

    // 2. Fallback Mirror Scrapers
    if (!success) {
      const mirrors = [
        `https://alfa-leetcode-api.onrender.com/userProfile/${username}`,
        `https://leetcode-api-faisalshohag.vercel.app/${username}`,
        `https://leetcode-stats-api.herokuapp.com/${username}`,
      ];

      for (const mirrorUrl of mirrors) {
        try {
          const mirrorRes = await fetch(mirrorUrl, { signal: AbortSignal.timeout(6000) });
          if (mirrorRes.ok) {
            const data = await mirrorRes.json();
            success = true;

            const easy = Number(data.easySolved ?? data.easy ?? 0);
            const med = Number(data.mediumSolved ?? data.medium ?? 0);
            const hard = Number(data.hardSolved ?? data.hard ?? 0);
            const tot = Number(data.totalSolved ?? (easy + med + hard));

            scrapedData.totalSolved = tot;
            scrapedData.easySolved = easy;
            scrapedData.mediumSolved = med;
            scrapedData.hardSolved = hard;
            scrapedData.ranking = data.ranking ?? null;
            scrapedData.reputation = data.reputation ?? data.contributionPoints ?? 0;
            scrapedData.avatarUrl = data.avatar ?? '';
            scrapedData.acceptanceRate = data.acceptanceRate ?? 0;
            scrapedData.countryName = data.country ?? '';
            scrapedData.company = data.company ?? '';
            scrapedData.school = data.school ?? '';
            scrapedData.aboutMe = data.about ?? '';

            if (data.submissionCalendar) {
              rawCalendarData = data.submissionCalendar;
            }

            if (Array.isArray(data.recentSubmissions)) {
              scrapedRecentList = data.recentSubmissions;
            }
            break;
          }
        } catch (mErr: any) {
          this.logger.warn(`Mirror ${mirrorUrl} failed: ${mErr.message}`);
        }
      }
    }

    // Parse Daily Commit Calendar & Streaks
    if (rawCalendarData) {
      const calStats = this.parseSubmissionCalendar(rawCalendarData);
      scrapedData.submissionCalendar = calStats.calendar;
      scrapedData.currentStreak = calStats.currentStreak;
      scrapedData.longestStreak = calStats.longestStreak;
      scrapedData.totalSubmissionsCount = calStats.totalSubmissions;
    }

    // Upsert recent AC submissions with accurate difficulty resolution
    let newSubmissionsCount = 0;
    for (const item of scrapedRecentList) {
      const title = item.title || item.titleSlug || 'LeetCode Problem';
      const slug = item.titleSlug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const timestamp = item.timestamp
        ? new Date(Number(item.timestamp) > 1e11 ? Number(item.timestamp) : Number(item.timestamp) * 1000)
        : new Date();

      const lang = item.lang || item.language || 'Python3';
      const status = item.statusDisplay || item.status || 'Accepted';

      if (status === 'Accepted' || !status) {
        // Resolve true problem difficulty and topics
        const meta = await this.resolveProblemDifficulty(slug);

        await this.prisma.leetCodeSubmission.upsert({
          where: {
            userId_titleSlug: {
              userId,
              titleSlug: slug,
            },
          },
          update: {
            title,
            difficulty: meta.difficulty,
            topics: meta.topics,
            language: lang,
            timestamp,
          },
          create: {
            userId,
            title,
            titleSlug: slug,
            difficulty: meta.difficulty,
            status: 'Accepted',
            language: lang,
            timestamp,
            topics: meta.topics,
          },
        });
        newSubmissionsCount++;
      }
    }

    // Update in-memory cache
    this.profileCache.set(userId, scrapedData as LeetCodeScrapedProfile);

    // Update persistent Redis cache (expires in 7 days)
    if (this.redis) {
      try {
        await this.redis.set(`leetcode:profile:${userId}`, JSON.stringify(scrapedData), 'EX', 86400 * 7);
        this.logger.log(`Persisted LeetCode profile for @${username} in Redis cache.`);
      } catch (rErr: any) {
        this.logger.warn(`Could not save LeetCode profile to Redis: ${rErr.message}`);
      }
    }

    const finalStats = await this.getStats(userId);

    return {
      message: success
        ? `Full telemetry scraped for @${username} (${newSubmissionsCount} recent submissions, ${finalStats.easyCount} Easy / ${finalStats.mediumCount} Med / ${finalStats.hardCount} Hard, contest ranking & daily calendar indexed)`
        : `Synced local repository for @${username}`,
      profile: finalStats,
    };
  }

  async createManualSubmission(userId: number, dto: CreateManualSubmissionDto) {
    const slug =
      dto.titleSlug?.trim() ||
      dto.title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');

    const difficulty =
      dto.difficulty?.charAt(0).toUpperCase() + dto.difficulty?.slice(1).toLowerCase() || 'Medium';

    const saved = await this.prisma.leetCodeSubmission.upsert({
      where: {
        userId_titleSlug: {
          userId,
          titleSlug: slug,
        },
      },
      update: {
        title: dto.title.trim(),
        difficulty,
        status: dto.status || 'Accepted',
        language: dto.language?.trim() || 'Python3',
        notes: dto.notes?.trim() || undefined,
        topics: dto.topics && dto.topics.length > 0 ? dto.topics : undefined,
        timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      },
      create: {
        userId,
        title: dto.title.trim(),
        titleSlug: slug,
        difficulty,
        status: dto.status || 'Accepted',
        language: dto.language?.trim() || 'Python3',
        notes: dto.notes?.trim() || '',
        topics: dto.topics && dto.topics.length > 0 ? dto.topics : ['Algorithm'],
        timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
      },
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `lc_${saved.id}`,
        sourceType: 'leetcode',
        sourceId: saved.id,
        title: `[LeetCode] ${saved.title} (${saved.difficulty})`,
        content: `${saved.title} [${saved.difficulty}] - Status: ${saved.status}. Topics: ${saved.topics.join(', ')}. Notes: ${saved.notes || ''}`,
        timestamp: saved.timestamp.toISOString(),
      })
      .catch(() => {});

    return saved;
  }

  async updateNotes(userId: number, id: number, notes: string) {
    const sub = await this.prisma.leetCodeSubmission.findFirst({
      where: { id, userId },
    });

    if (!sub) throw new NotFoundException(`Submission #${id} not found`);

    const updated = await this.prisma.leetCodeSubmission.update({
      where: { id },
      data: { notes: notes.trim() },
    });

    // Incremental background vectorization to Pinecone
    this.pineconeService
      .upsertMemory(userId, {
        id: `lc_${updated.id}`,
        sourceType: 'leetcode',
        sourceId: updated.id,
        title: `[LeetCode] ${updated.title} (${updated.difficulty})`,
        content: `${updated.title} [${updated.difficulty}] - Status: ${updated.status}. Topics: ${updated.topics.join(', ')}. Notes: ${updated.notes || ''}`,
        timestamp: updated.timestamp.toISOString(),
      })
      .catch(() => {});

    return updated;
  }

  async removeSubmission(userId: number, id: number) {
    const sub = await this.prisma.leetCodeSubmission.findFirst({
      where: { id, userId },
    });

    if (!sub) throw new NotFoundException(`Submission #${id} not found`);

    const deleted = await this.prisma.leetCodeSubmission.delete({
      where: { id },
    });

    // Incremental background vector deletion from Pinecone
    this.pineconeService.deleteMemory(userId, id, 'leetcode').catch(() => {});

    return deleted;
  }
}
