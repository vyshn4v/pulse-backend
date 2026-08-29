export interface DailySynthesisResponseDto {
  id: number;
  date: string;
  summary: string;
  highlights: string[];
  actionItems: string[];
  risksOrBlockers: string[];
  cognitiveScore: number;
  rawLLMResponse?: string;
  metricsSnapshot: any;
  emailDelivered: boolean;
  emailDeliveredAt?: string | null;
  createdAt: string;
}

export interface BrainStatsDto {
  totalSyntheses: number;
  latestScore: number;
  averageScore: number;
  totalIndexedMemories: number;
  lastSynthesisDate: string | null;
  nextScheduledTime: string;
}

export interface BrainMemoryItemDto {
  id: number;
  sourceType: string;
  sourceId?: number | null;
  title: string;
  content: string;
  vectorId?: string | null;
  metadata: any;
  createdAt: string;
}
