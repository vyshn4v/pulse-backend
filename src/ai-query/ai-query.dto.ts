export class AskAiQueryDto {
  query: string;
  model?: string;
  includeHistory?: boolean;
}

export interface AiSourceCitation {
  type: string; // 'activity' | 'job' | 'leetcode' | 'linkedin' | 'synthesis' | 'memory'
  id: number | string;
  title: string;
  snippet: string;
  timestamp?: string;
}

export interface AiQueryResponseDto {
  id: number;
  query: string;
  answer: string;
  sources: AiSourceCitation[];
  latencyMs: number;
  modelUsed: string;
  createdAt: string;
}
