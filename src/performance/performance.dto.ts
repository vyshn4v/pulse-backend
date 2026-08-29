export interface PerformanceTimeRangeDto {
  range?: '7d' | '30d' | '90d' | '1y' | 'all';
}

export interface PillarScore {
  score: number; // 0-100
  weight: number; // percentage
  status: 'optimal' | 'moderate' | 'lagging';
  title: string;
  metricReadout: string;
  trend: 'up' | 'down' | 'neutral';
  deltaPercent: number;
}

export interface PerformanceOverviewDto {
  momentumIndex: number; // 0-100
  momentumGrade: string; // "A+", "A", "B", etc.
  momentumStatus: string; // "PEAK VELOCITY", "STEADY COMPOUNDING", etc.
  streakDays: number;
  pillars: {
    engineering: PillarScore;
    career: PillarScore;
    thoughtLeadership: PillarScore;
    execution: PillarScore;
  };
  activityStats: {
    total: number;
    rangeCount: number;
    byCategory: Record<string, number>;
    dailyAverage: number;
  };
  jobStats: {
    totalApplied: number;
    activeApplications: number;
    interviewsScheduled: number;
    offersReceived: number;
    funnelConversionRate: number; // % applied that reached interview
  };
  leetcodeStats: {
    totalSolved: number;
    easyCount: number;
    mediumCount: number;
    hardCount: number;
    dailyStreak: number;
    weeklySolvedRate: number;
  };
  linkedinStats: {
    totalPosts: number;
    publishedCount: number;
    scheduledCount: number;
    totalImpressions: number;
    totalEngagements: number;
    avgEngagementRate: number;
  };
  timelineData: Array<{
    date: string;
    activities: number;
    leetcodeSolved: number;
    jobApplications: number;
    linkedinPosts: number;
    cumulativeMomentum: number;
  }>;
}
