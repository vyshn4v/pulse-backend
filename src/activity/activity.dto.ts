export class CreateActivityDto {
  title: string;
  category?: string; // work, personal, health, learning, finance, other
  description?: string;
  status?: string; // pending, in-progress, done
  date?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  metadata?: Record<string, any>;
}

export class UpdateActivityDto {
  title?: string;
  category?: string;
  description?: string;
  status?: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  metadata?: Record<string, any>;
}
