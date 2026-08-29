export class CreateProjectDto {
  title: string;
  description?: string;
  repoUrl?: string;
  liveUrl?: string;
  coverImage?: string;
  techStack?: string[];
  category?: string;
  status?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  isHidden?: boolean;
  isFeatured?: boolean;
  highlights?: string[];
  metrics?: Record<string, any>;
}

export class UpdateProjectDto {
  title?: string;
  description?: string;
  repoUrl?: string;
  liveUrl?: string;
  coverImage?: string;
  techStack?: string[];
  category?: string;
  status?: string;
  startDate?: string | Date;
  endDate?: string | Date;
  isHidden?: boolean;
  isFeatured?: boolean;
  highlights?: string[];
  metrics?: Record<string, any>;
}

export class PublicProjectsQueryDto {
  category?: string;
  techStack?: string;
  limit?: number;
  sort?: 'latest' | 'popular';
  featured?: boolean;
  status?: string;
}
