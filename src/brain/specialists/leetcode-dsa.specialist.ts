import { Injectable, Logger } from '@nestjs/common';
import { LlmProviderService } from '../services/llm-provider.service';
import { DsaSpecialistReport } from '../types/specialist.types';

@Injectable()
export class LeetCodeDsaSpecialist {
  private readonly logger = new Logger(LeetCodeDsaSpecialist.name);

  constructor(private readonly llm: LlmProviderService) {}

  async analyze(persona: string, solvedProblems: any[], weekSolved: any[]): Promise<DsaSpecialistReport> {
    const easyCount = solvedProblems.filter((p) => p.difficulty === 'Easy').length;
    const mediumCount = solvedProblems.filter((p) => p.difficulty === 'Medium').length;
    const hardCount = solvedProblems.filter((p) => p.difficulty === 'Hard').length;

    // Extract all unique topics
    const topicFrequency: Record<string, number> = {};
    for (const p of solvedProblems) {
      if (Array.isArray(p.topics)) {
        for (const t of p.topics) {
          topicFrequency[t] = (topicFrequency[t] || 0) + 1;
        }
      }
    }

    const sortedTopics = Object.entries(topicFrequency).sort((a, b) => b[1] - a[1]);
    const strongTopics = sortedTopics.slice(0, 3).map(([t]) => t);
    const commonTopics = ['Dynamic Programming', 'Graph', 'Tree', 'Binary Search', 'Sliding Window', 'Trie', 'Backtracking'];
    const neglectedTopics = commonTopics.filter((t) => !topicFrequency[t] || topicFrequency[t] < 2);

    const systemPrompt = `You are the PULSE Competitive Programming & DSA Mastery Specialist Agent.
Your role is to deeply analyze the engineer's problem-solving cadence, algorithmic distribution (Easy/Medium/Hard), topic coverage, and weaknesses.
Return strictly valid JSON matching this schema:
{
  "domain": "dsa_and_algorithms",
  "masteryScore": 82,
  "weeklySolvedCount": 4,
  "totalSolvedCount": 65,
  "strongTopics": ["Dynamic Programming", "Array", "Two Pointers"],
  "blindspotsOrNeglectedTopics": ["Trie", "Graph Dijkstra", "Backtracking"],
  "interviewReadinessLevel": "Senior",
  "suggestedProblemToday": {
    "title": "Word Search II",
    "topic": "Trie / Backtracking",
    "difficulty": "Hard",
    "reason": "Reinforces your Trie traversal blindspot for tier-1 tech interviews."
  },
  "domainRecommendation": "Target 1 Medium or Hard Graph problem today to balance your DP-heavy distribution."
}`;

    const userPrompt = `Engineer Persona: ${persona}
Total Accepted LeetCode Solves: ${solvedProblems.length} (${weekSolved.length} solved this week)
- Easy: ${easyCount} | Medium: ${mediumCount} | Hard: ${hardCount}
- Top Mastered Topics: ${strongTopics.join(', ') || 'Array, String'}
- Potential Blindspots: ${neglectedTopics.slice(0, 4).join(', ') || 'Graph, Dynamic Programming'}

Recent 5 Submissions:
${
  solvedProblems
    .slice(0, 5)
    .map((p) => `- ${p.title} (${p.difficulty}) [Topics: ${(p.topics || []).join(', ')}]`)
    .join('\n') || 'No problems solved yet.'
}
`;

    return this.llm.callFastSpecialist<DsaSpecialistReport>(systemPrompt, userPrompt, 'LeetCodeDsaSpecialist');
  }
}
