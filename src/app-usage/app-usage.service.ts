import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { LogAppUsageDto, BatchLogAppUsageDto, AppUsageQueryDto } from './dto/app-usage.dto';

@Injectable()
export class AppUsageService {
  private readonly logger = new Logger(AppUsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  // ---------------------------------------------------------------------------
  // Category & Productivity Auto-Classification
  // ---------------------------------------------------------------------------

  private classifyApp(appName: string, windowTitle?: string): { category: string; isProductive: boolean } {
    const name = (appName || '').toLowerCase();
    const title = (windowTitle || '').toLowerCase();

    // 1. Coding & IDEs
    if (
      name.includes('code') ||
      name.includes('cursor') ||
      name.includes('webstorm') ||
      name.includes('intellij') ||
      name.includes('pycharm') ||
      name.includes('neovim') ||
      name.includes('vim') ||
      name.includes('sublime') ||
      name.includes('xcode') ||
      name.includes('visual studio')
    ) {
      return { category: 'coding', isProductive: true };
    }

    // 2. Terminal & Shell
    if (
      name.includes('terminal') ||
      name.includes('iterm') ||
      name.includes('warp') ||
      name.includes('powershell') ||
      name.includes('bash') ||
      name.includes('alacritty') ||
      name.includes('hyper')
    ) {
      return { category: 'terminal', isProductive: true };
    }

    // 3. API & Developer Tools
    if (
      name.includes('postman') ||
      name.includes('insomnia') ||
      name.includes('docker') ||
      name.includes('dbeaver') ||
      name.includes('tableplus') ||
      name.includes('pgadmin')
    ) {
      return { category: 'coding', isProductive: true };
    }

    // 4. Design & Creative
    if (name.includes('figma') || name.includes('photoshop') || name.includes('illustrator') || name.includes('canva')) {
      return { category: 'design', isProductive: true };
    }

    // 5. Communication
    if (
      name.includes('slack') ||
      name.includes('teams') ||
      name.includes('zoom') ||
      name.includes('discord') ||
      name.includes('telegram')
    ) {
      return { category: 'communication', isProductive: !name.includes('discord') };
    }

    // 6. Browsers (Context-aware based on window title)
    if (name.includes('chrome') || name.includes('arc') || name.includes('brave') || name.includes('firefox') || name.includes('safari') || name.includes('edge')) {
      if (
        title.includes('youtube') ||
        title.includes('netflix') ||
        title.includes('twitter') ||
        title.includes('reddit') ||
        title.includes('instagram') ||
        title.includes('twitch')
      ) {
        return { category: 'entertainment', isProductive: false };
      }
      return { category: 'research', isProductive: true };
    }

    // 7. Entertainment & Music
    if (
      name.includes('spotify') ||
      name.includes('apple music') ||
      name.includes('steam') ||
      name.includes('game')
    ) {
      return { category: 'entertainment', isProductive: false };
    }

    return { category: 'other', isProductive: true };
  }

  // ---------------------------------------------------------------------------
  // Log Single & Batch Usage
  // ---------------------------------------------------------------------------

  async logUsage(userId: number, dto: LogAppUsageDto) {
    const classification = this.classifyApp(dto.appName, dto.windowTitle);
    const category = dto.category || classification.category;
    const isProductive = dto.isProductive !== undefined ? dto.isProductive : classification.isProductive;
    const date = dto.date ? new Date(dto.date) : new Date();

    const log = await this.prisma.appUsageLog.create({
      data: {
        userId,
        appName: dto.appName,
        category,
        windowTitle: dto.windowTitle || '',
        durationSeconds: dto.durationSeconds,
        date,
        isProductive,
        metadata: dto.metadata || {},
      },
    });

    return log;
  }

  async batchLogUsage(userId: number, dto: BatchLogAppUsageDto) {
    if (!dto.logs || dto.logs.length === 0) return { count: 0 };

    const records = dto.logs.map((item) => {
      const classification = this.classifyApp(item.appName, item.windowTitle);
      const category = item.category || classification.category;
      const isProductive = item.isProductive !== undefined ? item.isProductive : classification.isProductive;
      const date = item.date ? new Date(item.date) : new Date();

      return {
        userId,
        appName: item.appName,
        category,
        windowTitle: item.windowTitle || '',
        durationSeconds: item.durationSeconds,
        date,
        isProductive,
        metadata: item.metadata || {},
      };
    });

    const result = await this.prisma.appUsageLog.createMany({
      data: records,
    });

    return { count: result.count };
  }

  // ---------------------------------------------------------------------------
  // Today's Real-Time Screentime Summary
  // ---------------------------------------------------------------------------

  async getTodaySummary(userId: number) {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const logs = await this.prisma.appUsageLog.findMany({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay },
      },
      orderBy: { date: 'asc' },
    });

    let totalSeconds = 0;
    let productiveSeconds = 0;
    let distractingSeconds = 0;

    const categoryMap: Record<string, number> = {
      coding: 0,
      terminal: 0,
      research: 0,
      communication: 0,
      design: 0,
      entertainment: 0,
      other: 0,
    };

    const appMap: Record<string, { seconds: number; isProductive: boolean; category: string }> = {};

    // 24-hour timeline buckets
    const hourlyTimeline = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: `${i.toString().padStart(2, '0')}:00`,
      productiveSeconds: 0,
      distractingSeconds: 0,
      totalSeconds: 0,
    }));

    let currentStreakSeconds = 0;
    let deepWorkBlocks = 0;

    logs.forEach((log) => {
      totalSeconds += log.durationSeconds;
      if (log.isProductive) {
        productiveSeconds += log.durationSeconds;
        currentStreakSeconds += log.durationSeconds;
        if (currentStreakSeconds >= 5400) {
          // 90 minutes deep work block
          deepWorkBlocks++;
          currentStreakSeconds = 0; // reset for next block
        }
      } else {
        distractingSeconds += log.durationSeconds;
        currentStreakSeconds = 0;
      }

      // Category breakdown
      const cat = log.category || 'other';
      categoryMap[cat] = (categoryMap[cat] || 0) + log.durationSeconds;

      // App breakdown
      if (!appMap[log.appName]) {
        appMap[log.appName] = { seconds: 0, isProductive: log.isProductive, category: cat };
      }
      appMap[log.appName].seconds += log.durationSeconds;

      // Hourly timeline
      const hour = new Date(log.date).getHours();
      if (hourlyTimeline[hour]) {
        hourlyTimeline[hour].totalSeconds += log.durationSeconds;
        if (log.isProductive) {
          hourlyTimeline[hour].productiveSeconds += log.durationSeconds;
        } else {
          hourlyTimeline[hour].distractingSeconds += log.durationSeconds;
        }
      }
    });

    const focusScore = totalSeconds > 0 ? Math.round((productiveSeconds / totalSeconds) * 100) : 0;

    const topApps = Object.entries(appMap)
      .map(([appName, data]) => ({
        appName,
        seconds: data.seconds,
        category: data.category,
        isProductive: data.isProductive,
        percentage: totalSeconds > 0 ? Math.round((data.seconds / totalSeconds) * 100) : 0,
      }))
      .sort((a, b) => b.seconds - a.seconds);

    return {
      date: startOfDay.toISOString(),
      totalSeconds,
      productiveSeconds,
      distractingSeconds,
      focusScore,
      deepWorkBlocks,
      contextSwitches: Math.max(0, logs.length - 1),
      categoryBreakdown: categoryMap,
      topApps,
      hourlyTimeline,
      logCount: logs.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Historical Analytics & Trends
  // ---------------------------------------------------------------------------

  async getHistoricalAnalytics(userId: number, query: AppUsageQueryDto) {
    const period = query.period || 'week';
    const now = new Date();
    let startDate: Date;
    const endDate: Date = query.endDate ? new Date(query.endDate) : new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    if (query.startDate) {
      startDate = new Date(query.startDate);
    } else if (period === 'month') {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      // 7 days default
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }

    startDate.setHours(0, 0, 0, 0);

    const logs = await this.prisma.appUsageLog.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
        ...(query.category ? { category: query.category } : {}),
      },
      orderBy: { date: 'asc' },
    });

    // Group by Day
    const dayMap: Record<string, { date: string; totalSeconds: number; productiveSeconds: number; distractingSeconds: number; focusScore: number; logs: number }> = {};

    logs.forEach((log) => {
      const dayKey = new Date(log.date).toISOString().split('T')[0];
      if (!dayMap[dayKey]) {
        dayMap[dayKey] = {
          date: dayKey,
          totalSeconds: 0,
          productiveSeconds: 0,
          distractingSeconds: 0,
          focusScore: 0,
          logs: 0,
        };
      }
      dayMap[dayKey].totalSeconds += log.durationSeconds;
      dayMap[dayKey].logs += 1;
      if (log.isProductive) {
        dayMap[dayKey].productiveSeconds += log.durationSeconds;
      } else {
        dayMap[dayKey].distractingSeconds += log.durationSeconds;
      }
    });

    const dailyTrend = Object.values(dayMap).map((d) => ({
      ...d,
      focusScore: d.totalSeconds > 0 ? Math.round((d.productiveSeconds / d.totalSeconds) * 100) : 0,
    }));

    let totalSecs = 0;
    let prodSecs = 0;
    let distSecs = 0;

    dailyTrend.forEach((d) => {
      totalSecs += d.totalSeconds;
      prodSecs += d.productiveSeconds;
      distSecs += d.distractingSeconds;
    });

    const avgFocusScore = dailyTrend.length > 0 && totalSecs > 0 ? Math.round((prodSecs / totalSecs) * 100) : 0;
    const dailyAverageHours = dailyTrend.length > 0 ? Number((totalSecs / 3600 / dailyTrend.length).toFixed(1)) : 0;

    // Calculate streak of productive days (focusScore >= 75%)
    let focusStreak = 0;
    for (let i = dailyTrend.length - 1; i >= 0; i--) {
      if (dailyTrend[i].focusScore >= 75) {
        focusStreak++;
      } else {
        break;
      }
    }

    return {
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      totalSeconds: totalSecs,
      productiveSeconds: prodSecs,
      distractingSeconds: distSecs,
      avgFocusScore,
      dailyAverageHours,
      focusStreakDays: focusStreak,
      dailyTrend,
    };
  }

  // ---------------------------------------------------------------------------
  // Live Telemetry Polling Stream / Logs Feed
  // ---------------------------------------------------------------------------

  async getRecentLogs(
    userId: number,
    opts: { limit?: number; search?: string; category?: string; device?: string },
  ) {
    const where: any = { userId };
    if (opts.category && opts.category !== 'all') {
      where.category = opts.category;
    }
    if (opts.search) {
      where.OR = [
        { appName: { contains: opts.search, mode: 'insensitive' } },
        { windowTitle: { contains: opts.search, mode: 'insensitive' } },
      ];
    }

    const logs = await this.prisma.appUsageLog.findMany({
      where,
      orderBy: { date: 'desc' },
      take: Math.min(opts.limit || 60, 200),
    });

    return logs.map((log) => {
      const meta: any = log.metadata || {};
      let device = meta.device;
      if (!device) {
        if (
          log.appName.toLowerCase().includes('mobile') ||
          log.appName.toLowerCase().includes('termux') ||
          (log.windowTitle && log.windowTitle.startsWith('com.'))
        ) {
          device = 'android';
        } else {
          device = 'pc';
        }
      }

      return {
        id: log.id,
        appName: log.appName,
        category: log.category,
        windowTitle: log.windowTitle,
        durationSeconds: log.durationSeconds,
        date: log.date,
        isProductive: log.isProductive,
        device,
        platform: meta.platform || (device === 'android' ? 'Android' : 'Desktop'),
        createdAt: log.createdAt,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Delete Log
  // ---------------------------------------------------------------------------

  async deleteLog(userId: number, id: number) {
    const log = await this.prisma.appUsageLog.findFirst({
      where: { id, userId },
    });
    if (!log) throw new NotFoundException(`App usage log #${id} not found`);

    return this.prisma.appUsageLog.delete({ where: { id } });
  }


  // ---------------------------------------------------------------------------
  // 21:00 PM Screentime Daily Digest Email
  // ---------------------------------------------------------------------------

  async sendDailyDigestEmail(userId: number) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.email) throw new NotFoundException(`User #${userId} not found or has no email.`);

    const today = await this.getTodaySummary(userId);

    const totalHours = (today.totalSeconds / 3600).toFixed(1);
    const prodHours = (today.productiveSeconds / 3600).toFixed(1);

    const emailSubject = `⚡ PULSE Daily Screen Time Digest · ${today.focusScore}% Focus Score (${prodHours}h Deep Work)`;

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #07090e; color: #e2e8f0; margin: 0; padding: 24px; }
    .card { background-color: #0f131c; border: 1px solid #1e293b; border-radius: 12px; padding: 24px; max-width: 600px; margin: 0 auto; }
    .header { border-bottom: 1px solid #1e293b; padding-bottom: 16px; margin-bottom: 20px; }
    .title { font-size: 20px; font-weight: 700; color: #38bdf8; margin: 0; }
    .meta { font-size: 13px; color: #94a3b8; margin-top: 4px; }
    .metric-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 20px 0; }
    .metric-box { background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 8px; padding: 12px; text-align: center; }
    .metric-val { font-size: 22px; font-weight: 700; color: #38bdf8; }
    .metric-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; margin-top: 4px; }
    .app-list { list-style: none; padding: 0; margin: 16px 0; }
    .app-item { display: flex; justify-content: space-between; padding: 8px 12px; border-radius: 6px; background: rgba(255,255,255,0.03); margin-bottom: 6px; font-size: 13px; }
    .footer { text-align: center; margin-top: 24px; font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2 class="title">⚡ PULSE 21:00 Developer Screen Time Digest</h2>
      <div class="meta">Date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}</div>
    </div>

    <div class="metric-grid">
      <div class="metric-box">
        <div class="metric-val">${today.focusScore}%</div>
        <div class="metric-label">Focus Score</div>
      </div>
      <div class="metric-box">
        <div class="metric-val">${prodHours}h</div>
        <div class="metric-label">Productive Work</div>
      </div>
      <div class="metric-box">
        <div class="metric-val">${today.deepWorkBlocks}</div>
        <div class="metric-label">Deep Work Blocks</div>
      </div>
    </div>

    <h4 style="color: #94a3b8; margin: 18px 0 8px;">Top Applications Today</h4>
    <ul class="app-list">
      ${today.topApps
        .slice(0, 5)
        .map(
          (app) => `
        <li class="app-item">
          <span><strong>${app.appName}</strong> (${app.category})</span>
          <span>${(app.seconds / 3600).toFixed(1)}h (${app.percentage}%)</span>
        </li>
      `,
        )
        .join('')}
    </ul>

    <div class="footer">
      PULSE v3 · Cognitive Momentum & Developer Focus Engine
    </div>
  </div>
</body>
</html>
    `;

    await this.mailService.enqueueEmail(user.email, emailSubject, htmlContent, 'screentime_digest');

    this.logger.log(`Queued 21:00 screen time digest for ${user.email}`);

    // Update DailyScreenTimeSummary in database
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    await this.prisma.dailyScreenTimeSummary.upsert({
      where: {
        userId_date: {
          userId,
          date: startOfDay,
        },
      },
      create: {
        userId,
        date: startOfDay,
        totalSeconds: today.totalSeconds,
        productiveSeconds: today.productiveSeconds,
        distractingSeconds: today.distractingSeconds,
        focusScore: today.focusScore,
        deepWorkBlocks: today.deepWorkBlocks,
        contextSwitches: today.contextSwitches,
        categoryBreakdown: today.categoryBreakdown as any,
        topApps: today.topApps as any,
        digestSent: true,
        digestSentAt: new Date(),
      },
      update: {
        totalSeconds: today.totalSeconds,
        productiveSeconds: today.productiveSeconds,
        distractingSeconds: today.distractingSeconds,
        focusScore: today.focusScore,
        deepWorkBlocks: today.deepWorkBlocks,
        contextSwitches: today.contextSwitches,
        categoryBreakdown: today.categoryBreakdown as any,
        topApps: today.topApps as any,
        digestSent: true,
        digestSentAt: new Date(),
      },
    });

    return { success: true, recipient: user.email, focusScore: today.focusScore };
  }
}
