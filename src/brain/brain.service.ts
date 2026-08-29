import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { DailySynthesisResponseDto, BrainStatsDto } from './brain.dto';

@Injectable()
export class BrainService implements OnModuleInit {
  private readonly logger = new Logger(BrainService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly pineconeService: PineconeService,
  ) {}

  onModuleInit() {
    this.logger.log('Autonomous Brain Intelligence Service active. Nightly synthesis scheduled for 5:00 AM IST.');
  }

  // ---------------------------------------------------------------------------
  // Nightly 5:00 AM Cron Scheduler
  // ---------------------------------------------------------------------------

  @Cron('0 5 * * *', {
    name: 'nightly-brain-synthesis',
    timeZone: 'Asia/Kolkata',
  })
  async handleNightlySynthesisCron() {
    this.logger.log('Executing 5:00 AM Autonomous Brain Synthesis cycle across active users...');
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
  // Core Synthesis Generator
  // ---------------------------------------------------------------------------

  async generateDailySynthesis(userId: number, sendEmail: boolean = false): Promise<DailySynthesisResponseDto> {
    this.logger.log(`Starting Cognitive Synthesis generation for user #${userId}...`);

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1. Fetch telemetry records in parallel
    const [user, meProfile, recentActivities, weekActivities, recentJobs, solvedProblems, recentPosts] =
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
      ]);

    if (!user) {
      throw new NotFoundException(`User #${userId} not found`);
    }

    // 2. Compute Metric Snapshots
    const activeJobs = recentJobs.filter((j) => ['applied', 'interview', 'offer'].includes(j.status));
    const interviews = recentJobs.filter((j) => j.status === 'interview');
    const recentSolved = solvedProblems.filter((p) => new Date(p.timestamp) >= sevenDaysAgo);
    const publishedPosts = recentPosts.filter((p) => p.status === 'published');
    const scheduledPosts = recentPosts.filter((p) => p.status === 'scheduled');
    const totalImpressions = publishedPosts.reduce((acc, p) => acc + (p.impressions || 0), 0);

    const metricsSnapshot = {
      activities24h: recentActivities.length,
      activities7d: weekActivities.length,
      dsaSolvedTotal: solvedProblems.length,
      dsaSolved7d: recentSolved.length,
      activeJobsCount: activeJobs.length,
      interviewsCount: interviews.length,
      publishedPostsCount: publishedPosts.length,
      scheduledPostsCount: scheduledPosts.length,
      totalImpressions,
      focusDomains: meProfile?.brainBehaviorPrefs ? (meProfile.brainBehaviorPrefs as any).focusDomains || [] : [],
    };

    // 3. Assemble LLM Prompt Context
    const systemPrompt = `You are the PULSE Autonomous Cognitive Synthesis Engine.
Analyze the engineer's telemetry, accomplishments, and goals.
Provide an executive synthesis with:
1. Executive Summary (2-3 concise paragraphs evaluating momentum and trajectory)
2. Top Accomplishments & Wins (3-5 bullet points)
3. Action Plan & Focus Roadmap for Today (3-5 high-priority actions)
4. Risks, Stalled Items, or Attention Warnings (1-3 items)
5. A Cognitive Momentum Score between 0 and 100 based on output.

Return your response strictly in structured JSON format with this exact schema:
{
  "summary": "...",
  "highlights": ["...", "..."],
  "actionItems": ["...", "..."],
  "risksOrBlockers": ["...", "..."],
  "cognitiveScore": 88
}`;

    const userPrompt = `Engineer Profile:
- Persona: ${meProfile?.whoAmI || 'Senior Software Engineer'}
- Core Goals: ${meProfile?.goals || 'Mastering Distributed Systems, DSA, and Career Advancement'}
- Focus Domains: ${(metricsSnapshot.focusDomains as string[]).join(', ') || 'Backend Systems, Distributed Systems, Cloud'}

Past 24-Hour Activities (${recentActivities.length} logged):
${
  recentActivities.map((a) => `- [${a.category.toUpperCase()}] ${a.title}: ${a.description} (Status: ${a.status})`).join('\n') ||
  'No activity log entries recorded in the last 24 hours.'
}

Technical Problem Solving (LeetCode):
- Total Solved: ${solvedProblems.length} (${recentSolved.length} solved this week)
- Recent problems: ${solvedProblems.slice(0, 5).map((p) => `${p.title} (${p.difficulty})`).join(', ') || 'None'}

Career Pipeline:
- Active Applications: ${activeJobs.length} active (${interviews.length} in interview phase)
- Recent Companies: ${recentJobs.slice(0, 4).map((j) => `${j.company} (${j.role}) - ${j.status}`).join(', ') || 'None'}

Thought Leadership (LinkedIn):
- Content Published: ${publishedPosts.length} posts (${totalImpressions} total views)
- Upcoming in Queue: ${scheduledPosts.length} posts scheduled
`;

    // 4. Call Synthesis LLM (with multi-provider fallback)
    let synthesisResult = await this.callLLM(systemPrompt, userPrompt);

    if (!synthesisResult) {
      synthesisResult = this.generateDeterministicSynthesis(meProfile, metricsSnapshot, recentActivities, recentJobs, solvedProblems, recentPosts);
    }

    // 5. Persist Synthesis to PostgreSQL
    const saved = await this.prisma.dailySynthesis.create({
      data: {
        userId,
        date: now,
        summary: synthesisResult.summary,
        highlights: synthesisResult.highlights,
        actionItems: synthesisResult.actionItems,
        risksOrBlockers: synthesisResult.risksOrBlockers,
        cognitiveScore: synthesisResult.cognitiveScore,
        rawLLMResponse: JSON.stringify(synthesisResult, null, 2),
        metricsSnapshot,
        emailDelivered: false,
      },
    });

    // 6. Auto-Index Memory in BrainMemory for Semantic Search
    await this.prisma.brainMemory.create({
      data: {
        userId,
        sourceType: 'synthesis',
        sourceId: saved.id,
        title: `Daily Synthesis · ${now.toLocaleDateString()}`,
        content: `${synthesisResult.summary}\n\nKey Wins:\n${synthesisResult.highlights.join('\n')}\n\nPriorities:\n${synthesisResult.actionItems.join('\n')}`,
        metadata: { score: synthesisResult.cognitiveScore, date: now.toISOString() },
      },
    });

    // 7. Enqueue 5:00 AM Email Digest via BullMQ Mail Queue
    if (sendEmail || process.env.AUTO_EMAIL_DAILY_SYNTHESIS === 'true') {
      await this.sendSynthesisEmail(user.email, saved);
    }

    this.logger.log(`Daily Synthesis #${saved.id} generated successfully (Score: ${saved.cognitiveScore}/100)`);

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
  // Multi-Provider LLM Integration
  // ---------------------------------------------------------------------------

  private async callLLM(systemPrompt: string, userPrompt: string): Promise<any | null> {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    const nimKey = process.env.NIM_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const openAiKey = process.env.OPENAI_API_KEY;

    // 1. Try OpenRouter / NIM
    if (openRouterKey || nimKey) {
      const endpoint = openRouterKey
        ? 'https://openrouter.ai/api/v1/chat/completions'
        : 'https://integrate.api.nvidia.com/v1/chat/completions';
      const key = openRouterKey || nimKey;
      const model = openRouterKey
        ? process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct'
        : 'meta/llama-3.1-70b-instruct';

      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.3,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            return JSON.parse(content);
          }
        }
      } catch (err: any) {
        this.logger.warn(`OpenRouter/NIM LLM attempt error: ${err.message}`);
      }
    }

    // 2. Try Gemini API
    if (geminiKey) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }],
              generationConfig: { responseMimeType: 'application/json', temperature: 0.3 },
            }),
            signal: AbortSignal.timeout(15000),
          },
        );

        if (res.ok) {
          const json = await res.json();
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            return JSON.parse(text);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Gemini LLM attempt error: ${err.message}`);
      }
    }

    // 3. Try Groq
    if (groqKey) {
      try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${groqKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3,
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (res.ok) {
          const json = await res.json();
          const content = json.choices?.[0]?.message?.content;
          if (content) {
            return JSON.parse(content);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Groq LLM attempt error: ${err.message}`);
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // Deterministic Fallback Engine (High-Fidelity Algorithmic Synthesis)
  // ---------------------------------------------------------------------------

  private generateDeterministicSynthesis(
    me: any,
    snapshot: any,
    activities: any[],
    jobs: any[],
    solved: any[],
    posts: any[],
  ) {
    const actCount = activities.length;
    const activeJobs = jobs.filter((j) => ['applied', 'interview'].includes(j.status)).length;
    const interviews = jobs.filter((j) => j.status === 'interview').length;
    const scheduledPosts = posts.filter((p) => p.status === 'scheduled').length;
    const totalSolved = solved.length;

    let score = 75;
    if (actCount >= 3) score += 10;
    if (activeJobs > 0) score += 5;
    if (interviews > 0) score += 5;
    if (scheduledPosts > 0) score += 5;
    score = Math.min(95, Math.max(60, score));

    return {
      summary: `Cognitive synthesis indicates steady compounding momentum across core focus domains. Technical problem solving stands at ${totalSolved} verified solutions, with ${actCount} active engineering ledger entries executed over the last 24 hours. Career pipeline maintains ${activeJobs} active opportunities with ${interviews} interview stages in progress. Content publishing engine has ${scheduledPosts} thought leadership pieces staged.`,
      highlights: [
        `Maintained consistent execution with ${actCount} engineering activities logged.`,
        `DSA repository verified at ${totalSolved} solved technical problems.`,
        `Active career funnel maintains ${activeJobs} opportunities across top-tier targets.`,
        scheduledPosts > 0
          ? `Automated LinkedIn content engine has ${scheduledPosts} posts queued.`
          : 'Content pipeline is primed for new technical insights.',
      ],
      actionItems: [
        'Complete 1-2 Medium/Hard DSA problems in targeted topic areas (DP, Graphs, or Trees).',
        'Review and advance active job application follow-ups and interview prep.',
        'Finalize and schedule technical thought leadership post for weekly LinkedIn cadence.',
        'Log daily engineering activities in the PULSE Activity Ledger to sustain consistency streak.',
      ],
      risksOrBlockers: [
        actCount === 0 ? 'No activities logged in the past 24 hours — log your standup tasks.' : 'Ensure daily LeetCode momentum is sustained without rest day gaps.',
        interviews === 0 ? 'No active interviews scheduled — accelerate target applications this week.' : 'Prepare mock interview behavioral and system design answers.',
      ],
      cognitiveScore: score,
    };
  }

  // ---------------------------------------------------------------------------
  // 5:00 AM Email Digest Delivery
  // ---------------------------------------------------------------------------

  private async sendSynthesisEmail(toEmail: string, synthesis: any) {
    const dateStr = new Date(synthesis.date).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });

    const subject = `🧠 PULSE 5:00 AM Daily Synthesis · ${dateStr} (Score: ${synthesis.cognitiveScore}/100)`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; background: #0c0f13; color: #edeae3; padding: 28px; border-radius: 8px; border: 1px solid #262c35;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #262c35; padding-bottom: 16px; margin-bottom: 20px;">
          <div>
            <p style="margin: 0; font-size: 11px; font-family: monospace; color: #e8a33d; text-transform: uppercase; letter-spacing: 0.1em;">AUTONOMOUS BRAIN TELEMETRY</p>
            <h2 style="margin: 4px 0 0; color: #edeae3; font-size: 20px;">Daily Cognitive Synthesis</h2>
          </div>
          <div style="background: rgba(232, 163, 61, 0.12); border: 1px solid #e8a33d; border-radius: 6px; padding: 6px 14px; text-align: center;">
            <span style="font-size: 22px; font-weight: bold; color: #e8a33d; font-family: monospace;">${synthesis.cognitiveScore}</span>
            <span style="font-size: 10px; color: #8a8f98; display: block;">SCORE</span>
          </div>
        </div>

        <p style="font-size: 13px; color: #8a8f98; margin: 0 0 16px;">${dateStr}</p>

        <!-- Executive Summary -->
        <div style="background: #12161c; border-left: 3px solid #e8a33d; padding: 16px; border-radius: 4px; margin-bottom: 20px; line-height: 1.6; font-size: 14px;">
          <strong style="color: #e8a33d; display: block; margin-bottom: 6px; font-size: 12px; font-family: monospace;">EXECUTIVE SUMMARY</strong>
          ${synthesis.summary}
        </div>

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
          <span style="font-size: 11px; color: #606770; font-family: monospace;">PULSE Cognitive Control OS · 5:00 AM Dispatch</span>
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
    let latest = await this.prisma.dailySynthesis.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!latest) {
      // Auto-generate initial synthesis if none exists
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
