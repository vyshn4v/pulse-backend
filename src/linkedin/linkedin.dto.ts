export class CreateLinkedInPostDto {
  topic?: string;
  content: string;
  status?: string; // draft, scheduled, published, review, archived
  scheduledFor?: string;
  publishedAt?: string;
  firstComment?: string;
  commentScheduledFor?: string;
  commentPublishedAt?: string;
  commentPosted?: boolean;
  retryCount?: number;
  commentRetryCount?: number;
  failureReason?: string;
  tags?: string[];
  mediaUrls?: string[];
  impressions?: number;
  reactions?: number;
  comments?: number;
  reposts?: number;
  postUrl?: string;
  notes?: string;
}

export class UpdateLinkedInPostDto {
  topic?: string;
  content?: string;
  status?: string;
  scheduledFor?: string;
  publishedAt?: string;
  firstComment?: string;
  commentScheduledFor?: string;
  commentPublishedAt?: string;
  commentPosted?: boolean;
  retryCount?: number;
  commentRetryCount?: number;
  failureReason?: string;
  tags?: string[];
  mediaUrls?: string[];
  impressions?: number;
  reactions?: number;
  comments?: number;
  reposts?: number;
  postUrl?: string;
  notes?: string;
}
