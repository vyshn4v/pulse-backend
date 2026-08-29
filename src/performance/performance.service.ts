import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LeetCodeService } from '../leetcode/leetcode.service';
import { PerformanceOverviewDto, PillarScore } from './performance.dto';

@Injectable()
export class PerformanceService {
  private readonly logger = new Logger(PerformanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly leetCodeService: LeetCodeService,
  ) {}

  async getOverview(userId: number, range: string = '30d'): Promise<PerformanceOverviewDto> {
    const now = new Date();
    let daysToLookBack = 30;
    if (range === '7d') daysToLookBack = 7;
    else if (range === '90d') daysToLookBack = 90;
    else if (range === '1y') daysToLookBack = 365;
    else if (range === 'all') daysToLookBack = 730;

    const startDate = new Date(now.getTime() - daysToLookBack * 24 * 60 * 60 * 1000);
    startDate.setHours(0, 0, 0, 0);

    // 1. Fetch Parallel Records from Database & LeetCode service
    const [activities, jobs, leetCodeStats, submissions, linkedinPosts] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: { userId },
        orderBy: { date: 'asc' },
      }),
      this.prisma.jobApplication.findMany({
        where: { userId },
        orderBy: { appliedAt: 'asc' },
      }),
      this.leetCodeService.getStats(userId).catch(() => null),
      this.prisma.leetCodeSubmission.findMany({
        where: { userId, status: 'Accepted' },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.linkedInPost.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // 2. Compute Filtered Range Subsets
    const rangeActivities = activities.filter((a) => new Date(a.date) >= startDate);
    const rangeJobs = jobs.filter((j) => new Date(j.appliedAt) >= startDate);
    const rangeSubmissions = submissions.filter((s) => new Date(s.timestamp) >= startDate);
    const rangePosts = linkedinPosts.filter((p) => new Date(p.createdAt) >= startDate);

    // 3. Category Breakdown for Activities
    const byCategory: Record<string, number> = {
      work: 0,
      learning: 0,
      personal: 0,
      health: 0,
      finance: 0,
      other: 0,
    };

    rangeActivities.forEach((a) => {
      const cat = (a.category || 'other').toLowerCase();
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    // 4. Job Pipeline Metrics
    const activeJobs = jobs.filter((j) => ['applied', 'interview', 'offer'].includes(j.status)).length;
    const interviewJobs = jobs.filter((j) => j.status === 'interview').length;
    const offerJobs = jobs.filter((j) => j.status === 'offer').length;
    const totalApplied = jobs.length;
    const funnelConversionRate =
      totalApplied > 0 ? Math.round(((interviewJobs + offerJobs) / totalApplied) * 100) : 0;

    // 5. LeetCode Metrics
    const totalSolved = leetCodeStats?.totalSolved || submissions.length || 0;
    const easyCount = leetCodeStats?.easySolved || submissions.filter((s) => s.difficulty === 'Easy').length || 0;
    const mediumCount = leetCodeStats?.mediumSolved || submissions.filter((s) => s.difficulty === 'Medium').length || 0;
    const hardCount = leetCodeStats?.hardSolved || submissions.filter((s) => s.difficulty === 'Hard').length || 0;
    const weeklySolvedRate =
      rangeSubmissions.length > 0
        ? Math.round((rangeSubmissions.length / Math.max(1, daysToLookBack / 7)) * 10) / 10
        : 0;

    // 6. LinkedIn Content Metrics
    const publishedPosts = linkedinPosts.filter((p) => p.status === 'published');
    const scheduledPosts = linkedinPosts.filter((p) => p.status === 'scheduled');
    const totalImpressions = publishedPosts.reduce((acc, p) => acc + (p.impressions || 0), 0);
    const totalReactions = publishedPosts.reduce((acc, p) => acc + (p.reactions || 0), 0);
    const totalComments = publishedPosts.reduce((acc, p) => acc + (p.comments || 0), 0);
    const totalReposts = publishedPosts.reduce((acc, p) => acc + (p.reposts || 0), 0);
    const totalEngagements = totalReactions + totalComments + totalReposts;
    const avgEngagementRate =
      totalImpressions > 0 ? Math.round((totalEngagements / totalImpressions) * 1000) / 10 : 0;

    // 7. Calculate Consecutive Active Streak Days
    const activityDatesSet = new Set(
      activities.map((a) => {
        const d = new Date(a.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      }),
    );

    let streakDays = 0;
    const checkDate = new Date();
    while (true) {
      const key = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
      if (activityDatesSet.has(key)) {
        streakDays++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else if (streakDays === 0) {
        checkDate.setDate(checkDate.getDate() - 1);
        const yKey = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        if (activityDatesSet.has(yKey)) {
          streakDays++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      } else {
        break;
      }
    }

    // 8. Multi-Pillar Score Evaluations (0-100 each)
    // Pillar A: Engineering (LeetCode + Technical Activities)
    const engScore = Math.min(100, Math.round((totalSolved / 50) * 40 + (mediumCount * 3 + hardCount * 6)));
    const engineeringPillar: PillarScore = {
      score: Math.max(15, Math.min(100, engScore)),
      weight: 30,
      status: engScore >= 75 ? 'optimal' : engScore >= 45 ? 'moderate' : 'lagging',
      title: 'Engineering & Problem Solving',
      metricReadout: `${totalSolved} solved (${mediumCount} Med / ${hardCount} Hard)`,
      trend: 'up',
      deltaPercent: 12,
    };

    // Pillar B: Career Funnel Velocity
    const careerRaw = (activeJobs * 10) + (interviewJobs * 25) + (offerJobs * 50);
    const careerScore = Math.min(100, Math.max(10, careerRaw));
    const careerPillar: PillarScore = {
      score: careerScore,
      weight: 25,
      status: careerScore >= 70 ? 'optimal' : careerScore >= 40 ? 'moderate' : 'lagging',
      title: 'Career & Pipeline Velocity',
      metricReadout: `${totalApplied} apps (${activeJobs} active · ${interviewJobs} interviews)`,
      trend: activeJobs > 0 ? 'up' : 'neutral',
      deltaPercent: 8,
    };

    // Pillar C: Thought Leadership & Content Engine
    const postScore = Math.min(100, (publishedPosts.length * 15) + (scheduledPosts.length * 10) + (totalImpressions > 100 ? 20 : 0));
    const linkedinPillar: PillarScore = {
      score: Math.max(10, Math.min(100, postScore)),
      weight: 20,
      status: postScore >= 65 ? 'optimal' : postScore >= 35 ? 'moderate' : 'lagging',
      title: 'Thought Leadership & Content',
      metricReadout: `${publishedPosts.length} published (${scheduledPosts.length} queued)`,
      trend: 'up',
      deltaPercent: 15,
    };

    // Pillar D: Daily Execution & Consistency
    const activeDaysInPeriod = new Set(
      rangeActivities.map((a) => new Date(a.date).toISOString().slice(0, 10)),
    ).size;
    const consistencyRate = Math.min(100, Math.round((activeDaysInPeriod / Math.max(1, daysToLookBack)) * 100));
    const executionScore = Math.min(100, Math.round(consistencyRate * 0.7 + Math.min(30, streakDays * 5)));
    const executionPillar: PillarScore = {
      score: Math.max(20, Math.min(100, executionScore)),
      weight: 25,
      status: executionScore >= 75 ? 'optimal' : executionScore >= 45 ? 'moderate' : 'lagging',
      title: 'Daily Execution & Streaks',
      metricReadout: `${streakDays}d streak (${activeDaysInPeriod}/${daysToLookBack} active days)`,
      trend: streakDays > 2 ? 'up' : 'neutral',
      deltaPercent: 5,
    };

    // 9. Composite Momentum Index (Weighted Sum)
    const momentumIndex = Math.round(
      (engineeringPillar.score * engineeringPillar.weight +
        careerPillar.score * careerPillar.weight +
        linkedinPillar.score * linkedinPillar.weight +
        executionPillar.score * executionPillar.weight) /
        100,
    );

    let momentumGrade = 'B+';
    let momentumStatus = 'STEADY COMPOUNDING';

    if (momentumIndex >= 90) {
      momentumGrade = 'A+';
      momentumStatus = 'PEAK COGNITIVE VELOCITY';
    } else if (momentumIndex >= 80) {
      momentumGrade = 'A';
      momentumStatus = 'HIGH VELOCITY MOMENTUM';
    } else if (momentumIndex >= 70) {
      momentumGrade = 'B+';
      momentumStatus = 'STEADY COMPOUNDING';
    } else if (momentumIndex >= 55) {
      momentumGrade = 'B';
      momentumStatus = 'MODERATE ACCELERATION';
    } else {
      momentumGrade = 'C+';
      momentumStatus = 'INITIALIZING TRAJECTORY';
    }

    // 10. Generate Time-Series Timeline Rollup
    const timelineData: Array<{
      date: string;
      activities: number;
      leetcodeSolved: number;
      jobApplications: number;
      linkedinPosts: number;
      cumulativeMomentum: number;
    }> = [];

    const numPoints = Math.min(daysToLookBack, 30);
    for (let i = numPoints - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const label = d.toLocaleDateString([], { month: 'short', day: 'numeric' });

      const actCount = activities.filter((a) => {
        const ad = new Date(a.date);
        return `${ad.getFullYear()}-${String(ad.getMonth() + 1).padStart(2, '0')}-${String(ad.getDate()).padStart(2, '0')}` === dateKey;
      }).length;

      const lcCount = submissions.filter((s) => {
        const sd = new Date(s.timestamp);
        return `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, '0')}-${String(sd.getDate()).padStart(2, '0')}` === dateKey;
      }).length;

      const jobCount = jobs.filter((j) => {
        const jd = new Date(j.appliedAt);
        return `${jd.getFullYear()}-${String(jd.getMonth() + 1).padStart(2, '0')}-${String(jd.getDate()).padStart(2, '0')}` === dateKey;
      }).length;

      const postCount = linkedinPosts.filter((lp) => {
        const lpd = new Date(lp.createdAt);
        return `${lpd.getFullYear()}-${String(lpd.getMonth() + 1).padStart(2, '0')}-${String(lpd.getDate()).padStart(2, '0')}` === dateKey;
      }).length;

      const dailyVelocity = actCount * 10 + lcCount * 25 + jobCount * 20 + postCount * 20;

      timelineData.push({
        date: label,
        activities: actCount,
        leetcodeSolved: lcCount,
        jobApplications: jobCount,
        linkedinPosts: postCount,
        cumulativeMomentum: Math.min(100, Math.round(momentumIndex * 0.7 + dailyVelocity * 0.3)),
      });
    }

    return {
      momentumIndex,
      momentumGrade,
      momentumStatus,
      streakDays,
      pillars: {
        engineering: engineeringPillar,
        career: careerPillar,
        thoughtLeadership: linkedinPillar,
        execution: executionPillar,
      },
      activityStats: {
        total: activities.length,
        rangeCount: rangeActivities.length,
        byCategory,
        dailyAverage: Math.round((rangeActivities.length / Math.max(1, daysToLookBack)) * 10) / 10,
      },
      jobStats: {
        totalApplied,
        activeApplications: activeJobs,
        interviewsScheduled: interviewJobs,
        offersReceived: offerJobs,
        funnelConversionRate,
      },
      leetcodeStats: {
        totalSolved,
        easyCount,
        mediumCount,
        hardCount,
        dailyStreak: streakDays,
        weeklySolvedRate,
      },
      linkedinStats: {
        totalPosts: linkedinPosts.length,
        publishedCount: publishedPosts.length,
        scheduledCount: scheduledPosts.length,
        totalImpressions,
        totalEngagements,
        avgEngagementRate,
      },
      timelineData,
    };
  }
}
