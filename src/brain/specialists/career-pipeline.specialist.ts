import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderService } from '../services/llm-provider.service';
import { CareerSpecialistReport } from '../types/specialist.types';

@Injectable()
export class CareerPipelineSpecialist {
  private readonly logger = new Logger(CareerPipelineSpecialist.name);

  constructor(private readonly llm: LlmProviderService) {}

  async analyze(persona: string, allJobs: any[]): Promise<CareerSpecialistReport> {
    const activeJobs = allJobs.filter((j) => ['applied', 'screening', 'interview', 'offer'].includes(j.status));
    const interviewJobs = allJobs.filter((j) => j.status === 'interview');
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Stalled: applied or screening and not updated in >7 days
    const stalledJobs = activeJobs.filter((j) => new Date(j.updatedAt || j.appliedAt) < sevenDaysAgo);

    const systemPrompt = `You are the PULSE Career Strategy & Tech Recruiting Pipeline Specialist Agent.
Your role is to deeply evaluate the candidate's active job pipeline, recruiter coordination status, conversion rates across funnel stages, and pinpoint high-urgency follow-ups.
Return strictly valid JSON matching this schema:
{
  "domain": "career_and_pipeline",
  "pipelineHealthScore": 78, // 0-100 score
  "activeApplicationsCount": 6,
  "interviewStageCount": 2,
  "stalledApplicationsCount": 1,
  "urgentFollowUps": [
    {
      "company": "Stripe",
      "role": "Backend Engineer",
      "suggestedAction": "Send follow-up email regarding round 2 system design feedback (stalled for 8 days)."
    }
  ],
  "interviewPrepFocus": "Revise distributed transactions, idempotency keys, and Kafka partitioning for upcoming fintech interview.",
  "domainRecommendation": "Follow up with Stripe recruiter this morning and submit 2 new applications to tier-1 companies."
}`;

    const userPrompt = `Engineer Persona: ${persona}
Total Applications: ${allJobs.length}
- Active Pipeline (${activeJobs.length}): ${activeJobs.map((j) => `${j.company} (${j.role}) - Stage: ${j.status}`).join('; ') || 'None'}
- In Interview Phase (${interviewJobs.length}): ${interviewJobs.map((j) => `${j.company} (${j.role})`).join('; ') || 'None'}
- Stalled / Inactive >7d (${stalledJobs.length}): ${stalledJobs.map((j) => `${j.company} (${j.role}) - Last updated: ${new Date(j.updatedAt || j.appliedAt).toLocaleDateString()}`).join('; ') || 'None'}
`;

    return this.llm.callFastSpecialist<CareerSpecialistReport>(systemPrompt, userPrompt, () =>
      this.deterministicFallback(allJobs, activeJobs, interviewJobs, stalledJobs),
    );
  }

  private deterministicFallback(
    allJobs: any[],
    activeJobs: any[],
    interviewJobs: any[],
    stalledJobs: any[],
  ): CareerSpecialistReport {
    const score = Math.min(
      100,
      Math.max(25, interviewJobs.length * 30 + activeJobs.length * 10 - stalledJobs.length * 8 + (allJobs.length > 0 ? 20 : 0)),
    );

    const urgentFollowUps = stalledJobs.slice(0, 3).map((j) => ({
      company: j.company,
      role: j.role,
      suggestedAction: `Check in with ${j.company} talent partner regarding application status.`,
    }));

    return {
      domain: 'career_and_pipeline',
      pipelineHealthScore: score,
      activeApplicationsCount: activeJobs.length,
      interviewStageCount: interviewJobs.length,
      stalledApplicationsCount: stalledJobs.length,
      urgentFollowUps,
      interviewPrepFocus:
        interviewJobs.length > 0
          ? `Focus prep on core architecture & systems design for ${interviewJobs[0].company} (${interviewJobs[0].role}).`
          : 'Refine resume impact bullets and target 3 high-alignment engineering roles.',
      domainRecommendation:
        urgentFollowUps.length > 0
          ? `Send quick status touchpoint to ${urgentFollowUps[0].company} recruiter.`
          : activeJobs.length > 0
          ? 'Pipeline is healthy. Continue daily interview prep.'
          : 'Expand pipeline by sourcing 2-3 target software engineering opportunities.',
    };
  }
}
