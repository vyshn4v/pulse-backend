export class LogAppUsageDto {
  appName: string;
  category?: string; // coding, terminal, research, communication, design, entertainment, other
  windowTitle?: string;
  durationSeconds: number;
  date?: string;
  isProductive?: boolean;
  metadata?: Record<string, any>;
}

export class BatchLogAppUsageDto {
  logs: LogAppUsageDto[];
}

export class AppUsageQueryDto {
  period?: 'today' | 'yesterday' | 'week' | 'month' | 'custom';
  startDate?: string;
  endDate?: string;
  category?: string;
}
