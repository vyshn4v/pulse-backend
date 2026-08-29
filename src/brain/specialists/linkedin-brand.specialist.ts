import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderService } from '../services/llm-provider.service';
import { BrandSpecialistReport } from '../types/specialist.types';

@Injectable()
export class LinkedInBrandSpecialist {
  private readonly logger = new Logger(LinkedInBrandSpecialist.name);

  constructor(private readonly llm: LlmProviderService) {}

  async analyze(persona: string, allPosts: any[]): Promise<BrandSpecialistReport> {
    const published = allPosts.filter((p) => p.status === 'published');
    const scheduled = allPosts.filter((p) => p.status === 'scheduled');
    const drafts = allPosts.filter((p) => p.status === 'draft');
    const totalImpressions = published.reduce((acc, p) => acc + (p.impressions || 0), 0);

    const tagCounts: Record<string, number> = {};
    for (const p of published) {
      if (Array.isArray(p.tags)) {
        for (const t of p.tags) {
          tagCounts[t] = (tagCounts[t] || 0) + (p.impressions || 1);
        }
      }
    }

    const topTopics = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    const systemPrompt = `You are the PULSE Personal Brand & Technical Thought Leadership Specialist Agent.
Your role is to analyze the engineer's LinkedIn content velocity, engagement analytics, queue health, and formulate high-impact technical post concepts.
Return strictly valid JSON matching this schema:
{
  "domain": "brand_and_thought_leadership",
  "brandMomentumScore": 80, // 0-100 score
  "publishedCount": 12,
  "scheduledQueueCount": 2,
  "totalImpressions": 4500,
  "topPerformingTopics": ["#DistributedSystems", "#PostgreSQL", "#SystemDesign"],
  "nextPostDraftPrompt": "Write a breakdown of how you reduced database connection overhead in NestJS using connection pooling and Fastify.",
  "domainRecommendation": "Queue up 1 scheduled post on your latest LeetCode or architecture learnings to keep your weekly publishing cadence active."
}`;

    const userPrompt = `Engineer Persona: ${persona}
Total Content Items: ${allPosts.length}
- Published Posts: ${published.length} (Total Impressions: ${totalImpressions})
- Scheduled in Queue: ${scheduled.length}
- Unfinished Drafts: ${drafts.length}
- Top Tags by Reach: ${topTopics.join(', ') || '#SoftwareEngineering, #Backend'}

Recent Posts:
${
  allPosts
    .slice(0, 4)
    .map((p) => `- [${p.status.toUpperCase()}] "${p.topic || p.content.slice(0, 60)}..." (Views: ${p.impressions || 0})`)
    .join('\n') || 'No posts recorded.'
}
`;

    return this.llm.callFastSpecialist<BrandSpecialistReport>(systemPrompt, userPrompt, 'LinkedInBrandSpecialist');
  }
}
