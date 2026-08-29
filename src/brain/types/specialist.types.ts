// ==============================================================================
// PULSE v3 - Multi-Agent Domain Specialist & Master Oracle Type Definitions
// ==============================================================================

export interface FocusSpecialistReport {
  domain: 'focus_and_productivity';
  velocityScore: number; // 0-100
  flowStateRating: 'Deep Focus' | 'Fragmented' | 'Stalled' | 'Optimal';
  completedTasksCount: number;
  blockedTasksCount: number;
  topDistractionsOrFrictions: string[];
  keyWins: string[];
  domainRecommendation: string;
}

export interface DsaSpecialistReport {
  domain: 'dsa_and_algorithms';
  masteryScore: number; // 0-100
  weeklySolvedCount: number;
  totalSolvedCount: number;
  strongTopics: string[];
  blindspotsOrNeglectedTopics: string[];
  interviewReadinessLevel: 'Junior' | 'Mid-Level' | 'Senior' | 'Staff-Target';
  suggestedProblemToday: {
    title: string;
    topic: string;
    difficulty: 'Easy' | 'Medium' | 'Hard';
    reason: string;
  };
  domainRecommendation: string;
}

export interface CareerSpecialistReport {
  domain: 'career_and_pipeline';
  pipelineHealthScore: number; // 0-100
  activeApplicationsCount: number;
  interviewStageCount: number;
  stalledApplicationsCount: number; // >7 days without update
  urgentFollowUps: Array<{
    company: string;
    role: string;
    suggestedAction: string;
  }>;
  interviewPrepFocus: string;
  domainRecommendation: string;
}

export interface BrandSpecialistReport {
  domain: 'brand_and_thought_leadership';
  brandMomentumScore: number; // 0-100
  publishedCount: number;
  scheduledQueueCount: number;
  totalImpressions: number;
  topPerformingTopics: string[];
  nextPostDraftPrompt: string;
  domainRecommendation: string;
}

export interface AggregatedSpecialistReports {
  focus: FocusSpecialistReport;
  dsa: DsaSpecialistReport;
  career: CareerSpecialistReport;
  brand: BrandSpecialistReport;
}

export interface FuturisticForecast {
  thirtyDayTrajectory: string;
  ninetyDayTrajectory: string;
  strategicInterventions: string[];
  highLeverageDirective: string;
}

export interface MasterSynthesisReport {
  summary: string;
  highlights: string[];
  actionItems: string[];
  risksOrBlockers: string[];
  cognitiveScore: number;
  crossDomainCorrelations: string[];
  futuristicForecast: FuturisticForecast;
  specialistBreakdown: {
    focusScore: number;
    dsaScore: number;
    careerScore: number;
    brandScore: number;
  };
}
