export class CreateMediumPostDto {
  title: string;
  url: string;
  subtitle?: string;
  coverImage?: string;
  tags?: string[];
  publishedAt?: string | Date;
  readingTimeMinutes?: number;
  claps?: number;
  responsesCount?: number;
  canonicalUrl?: string;
  isHidden?: boolean;
  isFeatured?: boolean;
}

export class UpdateMediumPostDto {
  title?: string;
  url?: string;
  subtitle?: string;
  coverImage?: string;
  tags?: string[];
  publishedAt?: string | Date;
  readingTimeMinutes?: number;
  claps?: number;
  responsesCount?: number;
  canonicalUrl?: string;
  isHidden?: boolean;
  isFeatured?: boolean;
}

export class FetchMediumMetadataDto {
  url: string;
}

export class PublicPostsQueryDto {
  tag?: string;
  limit?: number;
  sort?: 'latest' | 'popular';
  featured?: boolean;
  status?: string;
}
