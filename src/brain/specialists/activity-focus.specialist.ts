import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderService } from '../services/llm-provider.service';
import { FocusSpecialistReport } from '../types/specialist.types';

@Injectable()
export class ActivityFocusSpecialist {
  private readonly logger = new Logger(ActivityFocusSpecialist.name);

  constructor(private readonly llm: LlmProviderService) {}

  async analyze(
    persona: string,
    recent24hActivities: any[],
    weekActivities: any[],
    screenTimeSummary?: { totalSeconds: number; topApps: { appName: string; durationSeconds: number; category: string }[] },
  ): Promise<FocusSpecialistReport> {
    const doneTasks = recent24hActivities.filter((a) => a.status === 'done');
    const inProgressTasks = recent24hActivities.filter((a) => a.status === 'in-progress');
    const blockedTasks = recent24hActivities.filter((a) => ['hold', 'rejected'].includes(a.status));

    const systemPrompt = `You are the PULSE Activity & Developer Focus Specialist Agent.
Your role is to deeply analyze the engineer's 24-hour execution velocity, task completion rate, friction points, and focus distribution.
Return strictly valid JSON matching this schema:
{
  "domain": "focus_and_productivity",
  "velocityScore": 85,
  "flowStateRating": "Deep Focus", // One of: "Deep Focus" | "Fragmented" | "Stalled" | "Optimal"
  "completedTasksCount": 3,
  "blockedTasksCount": 1,
  "topDistractionsOrFrictions": ["Blocked by third-party API keys", "Context switching between docs and backend"],
  "keyWins": ["Completed LeetCode DP problem", "Shipped Redis worker queue"],
  "domainRecommendation": "Dedicate the first 90-minute block today to unblocking the Postgres connection pool before new tasks."
}`;

    const userPrompt = `Engineer Persona: ${persona}
Total Logged Tasks in Last 24 Hours: ${recent24hActivities.length}
- Completed (${doneTasks.length}): ${doneTasks.map((t) => `${t.title} (${t.category})`).join('; ') || 'None'}
- In Progress (${inProgressTasks.length}): ${inProgressTasks.map((t) => `${t.title} (${t.category})`).join('; ') || 'None'}
- Blocked / On Hold (${blockedTasks.length}): ${blockedTasks.map((t) => `${t.title} [Reason: ${t.reason || 'Not specified'}]`).join('; ') || 'None'}

7-Day Cumulative Activity Count: ${weekActivities.length} tasks

Screen Time Telemetry:
${
  screenTimeSummary && screenTimeSummary.totalSeconds > 0
    ? `Total Active Screen Time: ${(screenTimeSummary.totalSeconds / 3600).toFixed(1)} hrs.
Top Applications: ${screenTimeSummary.topApps.map((a) => `${a.appName} (${(a.durationSeconds / 60).toFixed(0)}m - ${a.category})`).join(', ')}`
    : 'No desktop screen time telemetry logged for this period.'
}
`;

    return this.llm.callFastSpecialist<FocusSpecialistReport>(systemPrompt, userPrompt, 'ActivityFocusSpecialist');
  }
}
