import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderService } from '../services/llm-provider.service';
import { AggregatedSpecialistReports, MasterSynthesisReport } from '../types/specialist.types';

@Injectable()
export class MasterOracleSynthesizer {
  private readonly logger = new Logger(MasterOracleSynthesizer.name);

  constructor(private readonly llm: LlmProviderService) {}

  async synthesize(
    persona: string,
    goals: string,
    focusDomains: string[],
    reports: AggregatedSpecialistReports,
  ): Promise<MasterSynthesisReport> {
    const systemPrompt = `You are the PULSE Chief Strategic Intelligence & Executive Oracle Engine.
You receive structured evaluation reports from 4 dedicated domain specialist agents:
1. Activity & Focus Specialist
2. LeetCode & DSA Mastery Specialist
3. Career & Pipeline Strategist
4. LinkedIn & Personal Brand Strategist

Your mission is NOT just to summarize, but to perform:
- High-level Cross-Domain Correlation (e.g. how daily focus and screen time impact interview readiness or career momentum)
- Long-Horizon Futuristic Forecasting (30-Day and 90-Day predictive trajectory under current vs optimized habits)
- High-Leverage Strategic Interventions & Unified Priority Roadmap for today
- Unified Cognitive Momentum Score (0-100)

Return your answer strictly in valid JSON matching this exact schema:
{
  "summary": "2-3 dense executive paragraphs evaluating current momentum, cognitive leverage, and strategic trajectory.",
  "highlights": ["Top accomplishment across domains 1", "Top accomplishment 2", "Top accomplishment 3"],
  "actionItems": ["Daily Priority 1", "Daily Priority 2", "Daily Priority 3", "Daily Priority 4"],
  "risksOrBlockers": ["Critical friction 1", "Critical risk 2"],
  "cognitiveScore": 86,
  "crossDomainCorrelations": [
    "High task completion in backend tasks directly aligns with your DSA graph mastery, but career follow-ups lag on heavy coding days.",
    "Scheduling LinkedIn posts on technical architecture increases recruiter engagement on your active applications."
  ],
  "futuristicForecast": {
    "thirtyDayTrajectory": "In 30 days, sustained 4+ weekly Medium/Hard DSA solves combined with active pipeline follow-ups will position you at a 75% interview conversion threshold.",
    "ninetyDayTrajectory": "In 90 days, consistent thought leadership and architectural execution will transition your market positioning toward Staff/Lead engineering roles.",
    "strategicInterventions": [
      "Front-load 30 minutes of recruiter communication before opening IDE.",
      "Anchor weekly LinkedIn posts directly to newly solved algorithmic challenges."
    ],
    "highLeverageDirective": "Eliminate open task blockers this morning, then tackle 1 Hard Trie problem before evening review."
  },
  "specialistBreakdown": {
    "focusScore": 85,
    "dsaScore": 80,
    "careerScore": 75,
    "brandScore": 70
  }
}`;

    const userPrompt = `Engineer Profile:
- Persona: ${persona}
- Core Ambition & Goals: ${goals}
- Key Focus Domains: ${focusDomains.join(', ') || 'Backend Engineering, Distributed Systems, Cloud'}

=========================================
TIER-1 DOMAIN SPECIALIST REPORTS:
=========================================

[1. Focus & Productivity Specialist]
- Velocity Score: ${reports.focus.velocityScore}/100 (Flow State: ${reports.focus.flowStateRating})
- Completed 24h: ${reports.focus.completedTasksCount} | Blocked: ${reports.focus.blockedTasksCount}
- Key Wins: ${reports.focus.keyWins.join(', ') || 'None'}
- Top Frictions: ${reports.focus.topDistractionsOrFrictions.join(', ') || 'None'}
- Domain Directive: ${reports.focus.domainRecommendation}

[2. DSA & Algorithms Specialist]
- Mastery Score: ${reports.dsa.masteryScore}/100 (Readiness: ${reports.dsa.interviewReadinessLevel})
- Weekly Solves: ${reports.dsa.weeklySolvedCount} (Total: ${reports.dsa.totalSolvedCount})
- Strong Topics: ${reports.dsa.strongTopics.join(', ')}
- Blindspots: ${reports.dsa.blindspotsOrNeglectedTopics.join(', ')}
- Target Problem Today: ${reports.dsa.suggestedProblemToday.title} (${reports.dsa.suggestedProblemToday.difficulty} - ${reports.dsa.suggestedProblemToday.topic})
- Domain Directive: ${reports.dsa.domainRecommendation}

[3. Career Pipeline Strategist]
- Health Score: ${reports.career.pipelineHealthScore}/100
- Active Applications: ${reports.career.activeApplicationsCount} (Interviews: ${reports.career.interviewStageCount}, Stalled: ${reports.career.stalledApplicationsCount})
- Urgent Follow-Ups: ${reports.career.urgentFollowUps.map((u) => `${u.company}: ${u.suggestedAction}`).join('; ') || 'None'}
- Prep Focus: ${reports.career.interviewPrepFocus}
- Domain Directive: ${reports.career.domainRecommendation}

[4. LinkedIn & Personal Brand Strategist]
- Brand Momentum Score: ${reports.brand.brandMomentumScore}/100
- Published: ${reports.brand.publishedCount} (Total Views: ${reports.brand.totalImpressions}) | Queue: ${reports.brand.scheduledQueueCount}
- Top Performing Tags: ${reports.brand.topPerformingTopics.join(', ')}
- Draft Concept: ${reports.brand.nextPostDraftPrompt}
- Domain Directive: ${reports.brand.domainRecommendation}
`;

    return this.llm.callMasterOracle<MasterSynthesisReport>(systemPrompt, userPrompt, () =>
      this.deterministicFallback(goals, reports),
    );
  }

  private deterministicFallback(goals: string, reports: AggregatedSpecialistReports): MasterSynthesisReport {
    const avgScore = Math.round(
      (reports.focus.velocityScore * 0.35 +
        reports.dsa.masteryScore * 0.25 +
        reports.career.pipelineHealthScore * 0.25 +
        reports.brand.brandMomentumScore * 0.15),
    );

    const highlights = [
      ...reports.focus.keyWins.slice(0, 2),
      reports.dsa.weeklySolvedCount > 0 ? `Solved ${reports.dsa.weeklySolvedCount} algorithms this week with ${reports.dsa.strongTopics.join('/')} mastery.` : 'Maintained technical problem solving review.',
      reports.career.interviewStageCount > 0 ? `Active in ${reports.career.interviewStageCount} interview stages.` : 'Career pipeline actively monitored.',
    ];

    const actionItems = [
      reports.focus.domainRecommendation,
      `Solve today's target: ${reports.dsa.suggestedProblemToday.title} (${reports.dsa.suggestedProblemToday.difficulty})`,
      reports.career.domainRecommendation,
      reports.brand.domainRecommendation,
    ];

    return {
      summary: `Your multi-domain cognitive performance is currently operating at a score of ${avgScore}/100. Technical mastery and execution flow remain strong, with key focus needed on unblocking critical task bottlenecks and maintaining recruiter momentum.`,
      highlights: highlights.slice(0, 4),
      actionItems,
      risksOrBlockers: [
        ...reports.focus.topDistractionsOrFrictions,
        reports.career.stalledApplicationsCount > 0 ? `${reports.career.stalledApplicationsCount} job application(s) require status follow-ups.` : 'No critical pipeline stalls.',
      ].filter(Boolean),
      cognitiveScore: avgScore,
      crossDomainCorrelations: [
        'Execution momentum in focus tasks directly elevates confidence and performance in DSA problem solving.',
        'Proactive pipeline follow-ups stabilize career velocity while technical skills compound.',
      ],
      futuristicForecast: {
        thirtyDayTrajectory: 'Maintaining your current cadence will solidify senior-level interview readiness and increase application conversion velocity by 35%.',
        ninetyDayTrajectory: 'Consistent cross-domain execution across DSA, systems engineering, and personal branding will position you strongly for top-tier engineering roles.',
        strategicInterventions: [
          'Address stalled pipeline applications in morning focus blocks.',
          'Rotate problem solving into identified blindspot topics.',
        ],
        highLeverageDirective: 'Execute your primary task blocker and complete 1 target algorithm problem today.',
      },
      specialistBreakdown: {
        focusScore: reports.focus.velocityScore,
        dsaScore: reports.dsa.masteryScore,
        careerScore: reports.career.pipelineHealthScore,
        brandScore: reports.brand.brandMomentumScore,
      },
    };
  }
}
