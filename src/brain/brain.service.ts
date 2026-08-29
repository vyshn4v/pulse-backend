import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { AppUsageService } from '../app-usage/app-usage.service';
import { DailySynthesisResponseDto, BrainStatsDto } from './brain.dto';
import { ActivityFocusSpecialist } from './specialists/activity-focus.specialist';
import { LeetCodeDsaSpecialist } from './specialists/leetcode-dsa.specialist';
import { CareerPipelineSpecialist } from './specialists/career-pipeline.specialist';
import { LinkedInBrandSpecialist } from './specialists/linkedin-brand.specialist';
import { MasterOracleSynthesizer } from './synthesizers/master-oracle.synthesizer';
import {
  AggregatedSpecialistReports,
  FocusSpecialistReport,
  DsaSpecialistReport,
  CareerSpecialistReport,
  BrandSpecialistReport,
  MasterSynthesisReport,
} from './types/specialist.types';

@Injectable()
export class BrainService implements OnModuleInit {
  private readonly logger = new Logger(BrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly pineconeService: PineconeService,
    private readonly appUsageService: AppUsageService,
    private readonly focusSpecialist: ActivityFocusSpecialist,
    private readonly dsaSpecialist: LeetCodeDsaSpecialist,
    private readonly careerSpecialist: CareerPipelineSpecialist,
    private readonly brandSpecialist: LinkedInBrandSpecialist,
    private readonly masterOracle: MasterOracleSynthesizer,
  ) {}

  onModuleInit() {
    this.logger.log('Multi-Agent Hierarchical Brain Intelligence active. Nightly synthesis scheduled for 5:00 AM IST.');
  }

  // ---------------------------------------------------------------------------
  // Nightly 5:00 AM Cron Scheduler
  // ---------------------------------------------------------------------------

  @Cron('0 5 * * *', {
    name: 'nightly-brain-synthesis',
    timeZone: 'Asia/Kolkata',
  })
  async handleNightlySynthesisCron() {
    this.logger.log('Executing 5:00 AM Multi-Agent Cognitive Synthesis cycle across active users...');
    const users = await this.prisma.user.findMany({
      select: { id: true, email: true },
    });

    for (const u of users) {
      try {
        await this.generateDailySynthesis(u.id, true);
      } catch (err: any) {
        this.logger.error(`Nightly synthesis error for user #${u.id}: ${err.message}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Core Multi-Agent Synthesis Generator
  // ---------------------------------------------------------------------------

  async generateDailySynthesis(userId: number, sendEmail: boolean = false): Promise<DailySynthesisResponseDto> {
    this.logger.log(`Starting Multi-Agent Cognitive Synthesis generation for user #${userId}...`);

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1. Fetch raw telemetry records in parallel across all services
    const [user, meProfile, recentActivities, weekActivities, recentJobs, solvedProblems, recentPosts, screenTimeSummary] =
      await Promise.all([
        this.prisma.user.findUnique({ where: { id: userId } }),
        this.prisma.meProfile.findUnique({ where: { id: userId } }),
        this.prisma.activityLog.findMany({
          where: { userId, date: { gte: oneDayAgo } },
          orderBy: { date: 'desc' },
        }),
        this.prisma.activityLog.findMany({
          where: { userId, date: { gte: sevenDaysAgo } },
        }),
        this.prisma.jobApplication.findMany({
          where: { userId },
          orderBy: { appliedAt: 'desc' },
        }),
        this.prisma.leetCodeSubmission.findMany({
          where: { userId, status: 'Accepted' },
          orderBy: { timestamp: 'desc' },
        }),
        this.prisma.linkedInPost.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
        }),
        this.appUsageService.getTodaySummary(userId).catch(() => null),
      ]);

    if (!user) {
      throw new NotFoundException(`User #${userId} not found`);
    }

    const persona = meProfile?.whoAmI || 'Senior Software Engineer / Tech Lead';
    const goals = meProfile?.goals || 'Mastering Distributed Systems, DSA, and Top-Tier Career Advancement';
    const focusDomains: string[] = meProfile?.brainBehaviorPrefs
      ? (meProfile.brainBehaviorPrefs as any).focusDomains || []
      : ['Backend Systems', 'Distributed Systems', 'Cloud'];

    const recentSolved = solvedProblems.filter((p) => new Date(p.timestamp) >= sevenDaysAgo);

    // 2. Execute Tier-1 Domain Specialists in Parallel (with resilient fallback isolation)
    this.logger.log('Dispatching Tier-1 Domain Specialist Agents in parallel...');
    const [focusSettled, dsaSettled, careerSettled, brandSettled] = await Promise.allSettled([
      this.focusSpecialist.analyze(
        persona,
        recentActivities,
        weekActivities,
        screenTimeSummary ? { totalSeconds: screenTimeSummary.totalSeconds, topApps: screenTimeSummary.topApps } : undefined,
      ),
      this.dsaSpecialist.analyze(persona, solvedProblems, recentSolved),
      this.careerSpecialist.analyze(persona, recentJobs),
      this.brandSpecialist.analyze(persona, recentPosts),
    ]);

    // Check if all specialists failed
    const failures: string[] = [];
    if (focusSettled.status === 'rejected') failures.push(`Focus Specialist: ${focusSettled.reason?.message || focusSettled.reason}`);
    if (dsaSettled.status === 'rejected') failures.push(`DSA Specialist: ${dsaSettled.reason?.message || dsaSettled.reason}`);
    if (careerSettled.status === 'rejected') failures.push(`Career Specialist: ${careerSettled.reason?.message || careerSettled.reason}`);
    if (brandSettled.status === 'rejected') failures.push(`Brand Specialist: ${brandSettled.reason?.message || brandSettled.reason}`);

    if (failures.length === 4) {
      const allFailMsg = `AI Synthesis Failed: All 4 domain specialist agents failed. Errors:\n${failures.join('\n')}`;
      this.logger.error(allFailMsg);
      throw new NotFoundException(allFailMsg);
    }

    const focusReport: FocusSpecialistReport =
      focusSettled.status === 'fulfilled'
        ? focusSettled.value
        : {
            domain: 'focus_and_productivity',
            velocityScore: 0,
            flowStateRating: 'Stalled',
            completedTasksCount: recentActivities.filter((a) => a.status === 'done').length,
            blockedTasksCount: recentActivities.filter((a) => ['hold', 'rejected'].includes(a.status)).length,
            topDistractionsOrFrictions: [`Specialist Analysis Unavailable: ${focusSettled.reason?.message || 'Failed'}`],
            keyWins: [],
            domainRecommendation: 'Focus specialist analysis failed to generate.',
          };

    const dsaReport: DsaSpecialistReport =
      dsaSettled.status === 'fulfilled'
        ? dsaSettled.value
        : {
            domain: 'dsa_and_algorithms',
            masteryScore: 0,
            weeklySolvedCount: recentSolved.length,
            totalSolvedCount: solvedProblems.length,
            strongTopics: [],
            blindspotsOrNeglectedTopics: [],
            interviewReadinessLevel: 'Junior',
            suggestedProblemToday: {
              title: 'Problem Recommendation Unavailable',
              topic: 'N/A',
              difficulty: 'Medium',
              reason: 'DSA specialist analysis failed to generate.',
            },
            domainRecommendation: 'DSA specialist analysis failed to generate.',
          };

    const careerReport: CareerSpecialistReport =
      careerSettled.status === 'fulfilled'
        ? careerSettled.value
        : {
            domain: 'career_and_pipeline',
            pipelineHealthScore: 0,
            activeApplicationsCount: recentJobs.filter((j) => ['applied', 'interview'].includes(j.status)).length,
            interviewStageCount: recentJobs.filter((j) => j.status === 'interview').length,
            stalledApplicationsCount: 0,
            urgentFollowUps: [],
            interviewPrepFocus: 'Career specialist analysis failed to generate.',
            domainRecommendation: 'Career specialist analysis failed to generate.',
          };

    const brandReport: BrandSpecialistReport =
      brandSettled.status === 'fulfilled'
        ? brandSettled.value
        : {
            domain: 'brand_and_thought_leadership',
            brandMomentumScore: 0,
            publishedCount: recentPosts.filter((p) => p.status === 'published').length,
            scheduledQueueCount: recentPosts.filter((p) => p.status === 'scheduled').length,
            totalImpressions: recentPosts.reduce((acc, p) => acc + (p.impressions || 0), 0),
            topPerformingTopics: [],
            nextPostDraftPrompt: 'Brand specialist analysis failed to generate.',
            domainRecommendation: 'Brand specialist analysis failed to generate.',
          };

    const aggregatedReports: AggregatedSpecialistReports = {
      focus: focusReport,
      dsa: dsaReport,
      career: careerReport,
      brand: brandReport,
    };

    // 3. Dispatch Tier-2 Master Oracle Synthesizer (Gemini / High-Reasoning LLM)
    this.logger.log('Dispatching Tier-2 Master Oracle Synthesizer for cross-domain forecasting...');
    const masterResult: MasterSynthesisReport = await this.masterOracle.synthesize(
      persona,
      goals,
      focusDomains,
      aggregatedReports,
    );

    // 4. Assemble Rich Metrics Snapshot
    const metricsSnapshot = {
      activities24h: recentActivities.length,
      activities7d: weekActivities.length,
      dsaSolvedTotal: solvedProblems.length,
      dsaSolved7d: recentSolved.length,
      activeJobsCount: recentJobs.filter((j) => ['applied', 'interview', 'offer'].includes(j.status)).length,
      interviewsCount: recentJobs.filter((j) => j.status === 'interview').length,
      publishedPostsCount: recentPosts.filter((p) => p.status === 'published').length,
      scheduledPostsCount: recentPosts.filter((p) => p.status === 'scheduled').length,
      totalImpressions: recentPosts.reduce((acc, p) => acc + (p.impressions || 0), 0),
      screenTimeSeconds: screenTimeSummary ? screenTimeSummary.totalSeconds : 0,
      specialistReports: aggregatedReports,
      crossDomainCorrelations: masterResult.crossDomainCorrelations,
      futuristicForecast: masterResult.futuristicForecast,
      specialistBreakdown: masterResult.specialistBreakdown,
    };

    // 5. Persist Synthesis to PostgreSQL
    const saved = await this.prisma.dailySynthesis.create({
      data: {
        userId,
        date: now,
        summary: masterResult.summary,
        highlights: masterResult.highlights,
        actionItems: masterResult.actionItems,
        risksOrBlockers: masterResult.risksOrBlockers,
        cognitiveScore: masterResult.cognitiveScore,
        rawLLMResponse: JSON.stringify(masterResult, null, 2),
        metricsSnapshot: metricsSnapshot as any,
        emailDelivered: false,
      },
    });

    // 6. Auto-Index Memory in BrainMemory for Semantic Search
    await this.prisma.brainMemory.create({
      data: {
        userId,
        sourceType: 'synthesis',
        sourceId: saved.id,
        title: `Multi-Agent Synthesis · ${now.toLocaleDateString()}`,
        content: `${masterResult.summary}\n\nKey Highlights:\n${masterResult.highlights.join('\n')}\n\n30-Day Trajectory:\n${masterResult.futuristicForecast?.thirtyDayTrajectory || 'N/A'}\n\nPriorities:\n${masterResult.actionItems.join('\n')}`,
        metadata: {
          score: masterResult.cognitiveScore,
          date: now.toISOString(),
          specialistScores: masterResult.specialistBreakdown,
        } as any,
      },
    });

    // 7. Enqueue 5:00 AM Email Digest via BullMQ Mail Queue
    if (sendEmail || process.env.AUTO_EMAIL_DAILY_SYNTHESIS === 'true') {
      await this.sendSynthesisEmail(user.email, saved, masterResult);
    }

    this.logger.log(`Multi-Agent Synthesis #${saved.id} generated successfully (Cognitive Score: ${saved.cognitiveScore}/100)`);

    return {
      id: saved.id,
      date: saved.date.toISOString(),
      summary: saved.summary,
      highlights: saved.highlights,
      actionItems: saved.actionItems,
      risksOrBlockers: saved.risksOrBlockers,
      cognitiveScore: saved.cognitiveScore,
      rawLLMResponse: saved.rawLLMResponse || '',
      metricsSnapshot: saved.metricsSnapshot,
      emailDelivered: saved.emailDelivered,
      emailDeliveredAt: saved.emailDeliveredAt ? saved.emailDeliveredAt.toISOString() : null,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // 5:00 AM Email Digest Delivery
  // ---------------------------------------------------------------------------

  private async sendSynthesisEmail(toEmail: string, synthesis: any, masterResult?: MasterSynthesisReport) {
    const dateStr = new Date(synthesis.date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const forecast = masterResult?.futuristicForecast;
    const correlations = masterResult?.crossDomainCorrelations || [];
    const breakdown = masterResult?.specialistBreakdown;

    const subject = `🧠 PULSE 5:00 AM Cognitive Synthesis & Forecast · ${dateStr} (Score: ${synthesis.cognitiveScore}/100)`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #0c0f13; color: #edeae3; padding: 28px; border-radius: 8px; border: 1px solid #262c35;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #262c35; padding-bottom: 16px; margin-bottom: 20px;">
          <div>
            <p style="margin: 0; font-size: 11px; font-family: monospace; color: #e8a33d; text-transform: uppercase; letter-spacing: 0.1em;">MULTI-AGENT HIERARCHICAL INTELLIGENCE</p>
            <h2 style="margin: 4px 0 0; color: #edeae3; font-size: 20px;">Daily Cognitive Synthesis & Oracle</h2>
          </div>
          <div style="background: rgba(232, 163, 61, 0.12); border: 1px solid #e8a33d; border-radius: 6px; padding: 6px 14px; text-align: center;">
            <span style="font-size: 22px; font-weight: bold; color: #e8a33d; font-family: monospace;">${synthesis.cognitiveScore}</span>
            <span style="font-size: 10px; color: #8a8f98; display: block;">SCORE</span>
          </div>
        </div>

        <p style="font-size: 13px; color: #8a8f98; margin: 0 0 16px;">${dateStr}</p>

        <!-- Specialist Domain Gauge Cards -->
        ${
          breakdown
            ? `
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 20px;">
          <div style="background: #12161c; border: 1px solid #262c35; border-radius: 4px; padding: 8px; text-align: center;">
            <div style="font-size: 16px; font-weight: bold; color: #e8a33d; font-family: monospace;">${breakdown.focusScore}</div>
            <div style="font-size: 9px; color: #8a8f98; text-transform: uppercase;">Focus</div>
          </div>
          <div style="background: #12161c; border: 1px solid #262c35; border-radius: 4px; padding: 8px; text-align: center;">
            <div style="font-size: 16px; font-weight: bold; color: #5fa8a0; font-family: monospace;">${breakdown.dsaScore}</div>
            <div style="font-size: 9px; color: #8a8f98; text-transform: uppercase;">DSA</div>
          </div>
          <div style="background: #12161c; border: 1px solid #262c35; border-radius: 4px; padding: 8px; text-align: center;">
            <div style="font-size: 16px; font-weight: bold; color: #98c379; font-family: monospace;">${breakdown.careerScore}</div>
            <div style="font-size: 9px; color: #8a8f98; text-transform: uppercase;">Career</div>
          </div>
          <div style="background: #12161c; border: 1px solid #262c35; border-radius: 4px; padding: 8px; text-align: center;">
            <div style="font-size: 16px; font-weight: bold; color: #61afef; font-family: monospace;">${breakdown.brandScore}</div>
            <div style="font-size: 9px; color: #8a8f98; text-transform: uppercase;">Brand</div>
          </div>
        </div>`
            : ''
        }

        <!-- Executive Summary -->
        <div style="background: #12161c; border-left: 3px solid #e8a33d; padding: 16px; border-radius: 4px; margin-bottom: 20px; line-height: 1.6; font-size: 14px;">
          <strong style="color: #e8a33d; display: block; margin-bottom: 6px; font-size: 12px; font-family: monospace;">EXECUTIVE SUMMARY</strong>
          ${synthesis.summary}
        </div>

        <!-- Futuristic Trajectory Forecasting -->
        ${
          forecast
            ? `
        <div style="background: #101720; border: 1px solid #3b82f6; border-radius: 6px; padding: 16px; margin-bottom: 20px;">
          <h3 style="font-size: 13px; color: #60a5fa; font-family: monospace; margin: 0 0 10px; text-transform: uppercase;">🔮 FUTURISTIC TRAJECTORY & PREDICTIVE FORECAST</h3>
          <p style="font-size: 13px; color: #d0d4dc; line-height: 1.5; margin: 0 0 8px;"><strong>30-Day Outlook:</strong> ${forecast.thirtyDayTrajectory}</p>
          <p style="font-size: 13px; color: #d0d4dc; line-height: 1.5; margin: 0 0 12px;"><strong>90-Day Vision:</strong> ${forecast.ninetyDayTrajectory}</p>
          ${
            forecast.highLeverageDirective
              ? `<div style="background: rgba(59, 130, 246, 0.15); padding: 8px 12px; border-radius: 4px; font-size: 12px; color: #93c5fd;"><strong>🎯 High-Leverage Directive:</strong> ${forecast.highLeverageDirective}</div>`
              : ''
          }
        </div>`
            : ''
        }

        <!-- Cross-Domain Correlations -->
        ${
          correlations.length > 0
            ? `
        <div style="margin-bottom: 20px; background: #131b1e; border: 1px solid #5fa8a0; border-radius: 6px; padding: 16px;">
          <h3 style="font-size: 13px; color: #5fa8a0; font-family: monospace; margin: 0 0 10px;">⚡ CROSS-DOMAIN CORRELATIONS</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #b8c4c7;">
            ${correlations.map((c) => `<li style="margin-bottom: 6px;">${c}</li>`).join('')}
          </ul>
        </div>`
            : ''
        }

        <!-- Key Highlights -->
        <div style="margin-bottom: 20px;">
          <h3 style="font-size: 14px; color: #5fa8a0; font-family: monospace; margin: 0 0 10px;">✦ TOP ACCOMPLISHMENTS & WINS</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #d0d4dc;">
            ${(synthesis.highlights as string[]).map((h) => `<li style="margin-bottom: 6px;">${h}</li>`).join('')}
          </ul>
        </div>

        <!-- Action Items -->
        <div style="margin-bottom: 20px; background: #12161c; border: 1px solid #262c35; border-radius: 6px; padding: 16px;">
          <h3 style="font-size: 14px; color: #e8a33d; font-family: monospace; margin: 0 0 10px;">⚡ HIGH-PRIORITY ACTION ROADMAP</h3>
          <ol style="margin: 0; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #edeae3;">
            ${(synthesis.actionItems as string[]).map((a) => `<li style="margin-bottom: 6px;">${a}</li>`).join('')}
          </ol>
        </div>

        <!-- Attention Warnings -->
        ${
          synthesis.risksOrBlockers?.length > 0
            ? `
        <div style="margin-bottom: 24px;">
          <h3 style="font-size: 13px; color: #e06c75; font-family: monospace; margin: 0 0 8px;">⚠️ ATTENTION & RISKS</h3>
          <ul style="margin: 0; padding-left: 20px; font-size: 12px; line-height: 1.5; color: #e06c75;">
            ${(synthesis.risksOrBlockers as string[]).map((r) => `<li>${r}</li>`).join('')}
          </ul>
        </div>`
            : ''
        }

        <div style="border-top: 1px solid #262c35; padding-top: 16px; margin-top: 24px; display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 11px; color: #606770; font-family: monospace;">PULSE Multi-Agent Cognitive Engine · 5:00 AM Dispatch</span>
          <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/brain" style="color: #e8a33d; font-size: 12px; text-decoration: none; font-weight: bold;">Open Autonomous Brain →</a>
        </div>
      </div>
    `;

    try {
      await this.mailService.enqueueEmail(toEmail, subject, html, 'daily_synthesis');
      await this.prisma.dailySynthesis.update({
        where: { id: synthesis.id },
        data: { emailDelivered: true, emailDeliveredAt: new Date() },
      });
      this.logger.log(`Daily synthesis email queued for ${toEmail}`);
    } catch (err: any) {
      this.logger.error(`Failed to queue daily synthesis email: ${err.message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Read APIs & Stats
  // ---------------------------------------------------------------------------

  async getLatestSynthesis(userId: number) {
    const latest = await this.prisma.dailySynthesis.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      return this.generateDailySynthesis(userId, false);
    }

    return latest;
  }

  async getSynthesisHistory(userId: number, limit: number = 15) {
    return this.prisma.dailySynthesis.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getStats(userId: number): Promise<BrainStatsDto> {
    const syntheses = await this.prisma.dailySynthesis.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { cognitiveScore: true, createdAt: true },
    });

    const memoryCount = await this.prisma.brainMemory.count({
      where: { userId },
    });

    const total = syntheses.length;
    const latestScore = total > 0 ? syntheses[0].cognitiveScore : 0;
    const avgScore = total > 0 ? Math.round(syntheses.reduce((acc, s) => acc + s.cognitiveScore, 0) / total) : 0;

    return {
      totalSyntheses: total,
      latestScore,
      averageScore: avgScore,
      totalIndexedMemories: memoryCount,
      lastSynthesisDate: total > 0 ? syntheses[0].createdAt.toISOString() : null,
      nextScheduledTime: '05:00 AM IST',
    };
  }

  async getMemories(userId: number, sourceType?: string, search?: string) {
    const where: any = { userId };
    if (sourceType && sourceType !== 'all') {
      where.sourceType = sourceType;
    }

    let memories = await this.prisma.brainMemory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      memories = memories.filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          m.content.toLowerCase().includes(q) ||
          m.sourceType.toLowerCase().includes(q),
      );
    }

    return memories;
  }

  async bulkIndexMemories(userId: number) {
    this.logger.log(`Starting bulk Pinecone vector indexing for user #${userId}...`);

    const [activities, jobs, solved, posts, meProfile] = await Promise.all([
      this.prisma.activityLog.findMany({ where: { userId } }),
      this.prisma.jobApplication.findMany({ where: { userId } }),
      this.prisma.leetCodeSubmission.findMany({ where: { userId } }),
      this.prisma.linkedInPost.findMany({ where: { userId } }),
      this.prisma.meProfile.findUnique({ where: { userId } }),
    ]);

    const vectorRecords: Array<any> = [];

    if (meProfile) {
      vectorRecords.push({
        id: `persona_${userId}`,
        sourceType: 'persona',
        sourceId: userId,
        title: `[User Persona & Goals] ${meProfile.whoAmI || 'Engineer Profile'}`,
        content: `Persona & Role: ${meProfile.whoAmI}\nGoals & Aspirations: ${meProfile.goals}\nBehavior Preferences: ${JSON.stringify(meProfile.brainBehaviorPrefs || {})}`,
        timestamp: meProfile.updatedAt.toISOString(),
      });

      if (meProfile.goals && meProfile.goals.trim()) {
        vectorRecords.push({
          id: `goals_${userId}`,
          sourceType: 'goals',
          sourceId: userId,
          title: `[Career & Technical Goals] ${meProfile.whoAmI || 'Core Goals'}`,
          content: meProfile.goals,
          timestamp: meProfile.updatedAt.toISOString(),
        });
      }
    }

    for (const a of activities) {
      vectorRecords.push({
        id: `act_${a.id}`,
        sourceType: 'activity',
        sourceId: a.id,
        title: `[Activity] ${a.title || a.category}`,
        content: `${a.title}: ${a.description} (Category: ${a.category}, Status: ${a.status})`,
        timestamp: a.date.toISOString(),
      });
    }

    for (const j of jobs) {
      vectorRecords.push({
        id: `job_${j.id}`,
        sourceType: 'job',
        sourceId: j.id,
        title: `[Job] ${j.company} - ${j.role}`,
        content: `${j.company} (${j.role}) - Status: ${j.status}. Source: ${j.source}. Notes: ${j.notes || 'None'}`,
        timestamp: j.appliedAt.toISOString(),
      });
    }

    for (const p of solved) {
      vectorRecords.push({
        id: `lc_${p.id}`,
        sourceType: 'leetcode',
        sourceId: p.id,
        title: `[LeetCode] ${p.title} (${p.difficulty})`,
        content: `${p.title} [${p.difficulty}] - Status: ${p.status}. Topics: ${p.topics.join(', ')}`,
        timestamp: p.timestamp.toISOString(),
      });
    }

    for (const po of posts) {
      vectorRecords.push({
        id: `li_${po.id}`,
        sourceType: 'linkedin',
        sourceId: po.id,
        title: `[LinkedIn] ${po.topic || 'Post #' + po.id}`,
        content: `${po.content} (Status: ${po.status}, Impressions: ${po.impressions || 0})`,
        timestamp: po.createdAt.toISOString(),
      });
    }

    const indexedCount = await this.pineconeService.bulkUpsertMemories(userId, vectorRecords);

    return {
      message: `Indexed ${indexedCount} semantic vector records into Pinecone Knowledge Base`,
      count: indexedCount,
    };
  }
}
