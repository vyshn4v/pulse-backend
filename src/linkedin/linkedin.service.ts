import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { CreateLinkedInPostDto, UpdateLinkedInPostDto } from './linkedin.dto';
import { getRedisConnectionOpts, BULLMQ_PREFIX } from '../workers/redis-connection';

const MAX_PUBLISH_RETRIES = 3;

interface LinkedInJobPayload {
  userId: number;
  postId: number;
  type: 'post' | 'comment';
}

@Injectable()
export class LinkedInService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinkedInService.name);
  private linkedinQueue: Queue<LinkedInJobPayload> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly pineconeService: PineconeService,
  ) {}

  async onModuleInit() {
    const connection = getRedisConnectionOpts();

    try {
      this.linkedinQueue = new Queue<LinkedInJobPayload>('linkedin-queue', {
        connection,
        prefix: BULLMQ_PREFIX,
        defaultJobOptions: {
          attempts: MAX_PUBLISH_RETRIES,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 300 },
        },
      });
      this.logger.log('LinkedInService Producer initialized for BullMQ queue.');

      // Check overdue posts on startup
      this.processAutoPublishQueue().catch((err) =>
        this.logger.warn(`Auto-publisher boot check warning: ${err.message}`),
      );
    } catch (err: any) {
      this.logger.warn(`Could not initialize BullMQ LinkedIn queue producer: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.linkedinQueue) {
      await this.linkedinQueue.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Account Connection (Direct .env Token OR OAuth 2.0)
  // ---------------------------------------------------------------------------

  getAuthUrl(userId: number): { url: string } {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:5000/api/linkedin/callback';

    if (!clientId) {
      throw new BadRequestException('LINKEDIN_CLIENT_ID is not configured in .env');
    }

    const state = Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString('base64');
    const scope = encodeURIComponent('openid profile email w_member_social');

    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(
      redirectUri,
    )}&state=${state}&scope=${scope}`;

    return { url };
  }

  async handleOAuthCallback(code: string, state: string) {
    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI || 'http://localhost:5000/api/linkedin/callback';

    if (!clientId || !clientSecret) {
      throw new BadRequestException('LinkedIn client credentials not configured in environment');
    }

    let userId = 1;
    if (state) {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        if (decoded.userId) userId = Number(decoded.userId);
      } catch {
        this.logger.warn(`Could not parse state: ${state}. Falling back to default user ID.`);
      }
    }

    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });

    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      this.logger.error(`LinkedIn token exchange error: ${errText}`);
      let parsedMsg = 'Failed to exchange authorization code';
      try {
        const errObj = JSON.parse(errText);
        parsedMsg = errObj.error_description || errObj.error || errObj.message || errText;
      } catch {
        parsedMsg = errText;
      }
      throw new BadRequestException(`LinkedIn: ${parsedMsg}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;
    const expiresIn = Number(tokenData.expires_in) || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const refreshToken = tokenData.refresh_token || null;

    let memberUrn = '';
    let accountName = '';

    try {
      const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (userRes.ok) {
        const userData = await userRes.json();
        const sub = userData.sub;
        memberUrn = `urn:li:person:${sub}`;
        accountName = userData.name || `${userData.given_name || ''} ${userData.family_name || ''}`.trim();
      }
    } catch (uErr: any) {
      this.logger.warn(`Could not fetch OpenID userinfo: ${uErr.message}`);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        linkedinAccessToken: accessToken,
        linkedinRefreshToken: refreshToken,
        linkedinMemberUrn: memberUrn || undefined,
        linkedinAccountName: accountName || undefined,
        linkedinTokenExpiresAt: expiresAt,
      },
    });

    return {
      success: true,
      accountName,
      memberUrn,
      expiresAt,
    };
  }

  async getAccountStatus(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        linkedinAccessToken: true,
        linkedinMemberUrn: true,
        linkedinAccountName: true,
        linkedinTokenExpiresAt: true,
      },
    });

    const envToken = process.env.LINKEDIN_ACCESS_TOKEN?.trim();
    const envUrn = process.env.LINKEDIN_MEMBER_URN?.trim();
    const envName = process.env.LINKEDIN_ACCOUNT_NAME?.trim();

    if (envToken) {
      return {
        isConnected: true,
        isExpired: false,
        accountName: envName || user?.linkedinAccountName || 'Direct .env API Token',
        memberUrn: envUrn || user?.linkedinMemberUrn || 'urn:li:person:configured',
        expiresAt: null,
        clientIdConfigured: true,
        source: 'env',
      };
    }

    const clientIdConfigured = !!process.env.LINKEDIN_CLIENT_ID;
    const isConnected = !!(user?.linkedinAccessToken && user?.linkedinMemberUrn);
    const isExpired = user?.linkedinTokenExpiresAt ? new Date(user.linkedinTokenExpiresAt) < new Date() : false;

    return {
      isConnected: isConnected && !isExpired,
      isExpired,
      accountName: user?.linkedinAccountName || '',
      memberUrn: user?.linkedinMemberUrn || '',
      expiresAt: user?.linkedinTokenExpiresAt || null,
      clientIdConfigured,
      source: 'oauth',
    };
  }

  async disconnectAccount(userId: number) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        linkedinAccessToken: null,
        linkedinRefreshToken: null,
        linkedinMemberUrn: null,
        linkedinAccountName: null,
        linkedinTokenExpiresAt: null,
      },
    });
    return { success: true, message: 'LinkedIn account disconnected' };
  }

  // ---------------------------------------------------------------------------
  // Non-Blocking Queue Producers (<2ms instantaneous dispatch)
  // ---------------------------------------------------------------------------

  async publishPostToLinkedIn(userId: number, postId: number) {
    if (this.linkedinQueue) {
      await this.linkedinQueue.add(
        'publish-post',
        { userId, postId, type: 'post' },
        {
          jobId: `publish-post-${postId}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`[LinkedIn Producer] Dispatched publish-post job to Redis for post #${postId}`);
      return { message: 'Post enqueued for LinkedIn delivery', postId };
    }
    throw new BadRequestException('LinkedIn publish queue is not ready');
  }

  async publishCommentToLinkedIn(userId: number, postId: number) {
    if (this.linkedinQueue) {
      await this.linkedinQueue.add(
        'publish-comment',
        { userId, postId, type: 'comment' },
        {
          jobId: `publish-comment-${postId}`,
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
      this.logger.log(`[LinkedIn Producer] Dispatched publish-comment job to Redis for post #${postId}`);
      return { message: '1st Comment enqueued for LinkedIn delivery', postId };
    }
    throw new BadRequestException('LinkedIn publish queue is not ready');
  }

  // ---------------------------------------------------------------------------
  // Cron Scheduler (Checks DB every 3 minutes and enqueues due jobs to BullMQ)
  // ---------------------------------------------------------------------------

  @Cron('*/3 * * * *')
  async processAutoPublishQueue() {
    const now = new Date();

    const duePosts = await this.prisma.linkedInPost.findMany({
      where: {
        status: 'scheduled',
        scheduledFor: { lte: now },
        retryCount: { lt: MAX_PUBLISH_RETRIES },
      },
      orderBy: { scheduledFor: 'asc' },
    });

    if (duePosts.length > 0) {
      this.logger.log(
        `[Auto-Publisher Cron] Server Time: ${now.toISOString()} | Found ${duePosts.length} due scheduled posts.`,
      );
    }

    for (const post of duePosts) {
      try {
        // Immediately transition to 'publishing' to prevent subsequent cron ticks from picking it up
        await this.prisma.linkedInPost.update({
          where: { id: post.id },
          data: { status: 'publishing' },
        });

        await this.publishPostToLinkedIn(post.userId, post.id);
      } catch (err: any) {
        this.logger.error(`Post #${post.id} auto-publish enqueue error: ${err.message}`);
      }
    }

    // Process due comments
    const dueComments = await this.prisma.linkedInPost.findMany({
      where: {
        status: 'published',
        commentPosted: false,
        commentRetryCount: { lt: MAX_PUBLISH_RETRIES },
        firstComment: { not: '' },
        commentScheduledFor: { lte: now },
        linkedinUrn: { not: '' },
      },
    });

    for (const post of dueComments) {
      try {
        await this.publishCommentToLinkedIn(post.userId, post.id);
      } catch (err: any) {
        this.logger.error(`Comment enqueue error for post #${post.id}: ${err.message}`);
      }
    }
  }

  async triggerManualPublisherRun() {
    this.logger.log('Manual trigger of LinkedIn Auto-Publisher Cron received.');
    await this.processAutoPublishQueue();
    return { success: true, message: 'LinkedIn Auto-Publisher Cron executed successfully' };
  }

  // ---------------------------------------------------------------------------
  // Standard Post CRUD & Stats
  // ---------------------------------------------------------------------------

  async getStats(userId: number) {
    const posts = await this.prisma.linkedInPost.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const scheduledPosts = posts.filter((p) => p.status === 'scheduled');
    const publishedPosts = posts.filter((p) => p.status === 'published');
    const draftPosts = posts.filter((p) => p.status === 'draft');
    const reviewPosts = posts.filter((p) => p.status === 'review');

    const totalImpressions = publishedPosts.reduce((acc, p) => acc + (p.impressions || 0), 0);
    const totalReactions = publishedPosts.reduce((acc, p) => acc + (p.reactions || 0), 0);
    const totalComments = publishedPosts.reduce((acc, p) => acc + (p.comments || 0), 0);
    const totalReposts = publishedPosts.reduce((acc, p) => acc + (p.reposts || 0), 0);
    const totalEngagements = totalReactions + totalComments + totalReposts;

    const upcomingScheduled = scheduledPosts
      .filter((p) => p.scheduledFor && new Date(p.scheduledFor) >= new Date())
      .sort((a, b) => new Date(a.scheduledFor!).getTime() - new Date(b.scheduledFor!).getTime());

    const nextScheduled = upcomingScheduled.length > 0 ? upcomingScheduled[0] : scheduledPosts[0] || null;

    const tagMap: Record<string, number> = {};
    posts.forEach((p) => {
      p.tags.forEach((t) => {
        tagMap[t] = (tagMap[t] || 0) + 1;
      });
    });
    const topTags = Object.entries(tagMap)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      totalPosts: posts.length,
      scheduledCount: scheduledPosts.length,
      publishedCount: publishedPosts.length,
      draftCount: draftPosts.length,
      reviewCount: reviewPosts.length,
      totalImpressions,
      totalReactions,
      totalComments,
      totalReposts,
      totalEngagements,
      nextScheduledPost: nextScheduled,
      topTags,
      recentPosts: posts.slice(0, 5),
    };
  }

  async findAll(userId: number, status?: string, tag?: string, search?: string) {
    const where: any = { userId };

    if (status && status !== 'all') {
      where.status = status;
    }

    if (tag && tag !== 'all') {
      where.tags = { has: tag };
    }

    let posts = await this.prisma.linkedInPost.findMany({
      where,
      orderBy: status === 'scheduled' ? { scheduledFor: 'asc' } : { createdAt: 'desc' },
    });

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      posts = posts.filter(
        (p) =>
          p.topic.toLowerCase().includes(q) ||
          p.content.toLowerCase().includes(q) ||
          p.firstComment?.toLowerCase().includes(q) ||
          p.failureReason?.toLowerCase().includes(q) ||
          p.notes?.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    return posts;
  }

  async findOne(userId: number, id: number) {
    const post = await this.prisma.linkedInPost.findFirst({
      where: { id, userId },
    });

    if (!post) {
      throw new NotFoundException(`LinkedIn post #${id} not found`);
    }

    return post;
  }

  async create(userId: number, dto: CreateLinkedInPostDto) {
    const status = dto.status || (dto.scheduledFor ? 'scheduled' : 'draft');
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    const publishedAt =
      dto.publishedAt
        ? new Date(dto.publishedAt)
        : status === 'published'
        ? new Date()
        : null;

    let commentScheduledFor: Date | null = null;
    if (dto.commentScheduledFor) {
      const commentDate = new Date(dto.commentScheduledFor);
      if (scheduledFor && commentDate < scheduledFor) {
        commentScheduledFor = new Date(scheduledFor.getTime() + 5 * 60 * 1000);
      } else {
        commentScheduledFor = commentDate;
      }
    } else if (dto.firstComment?.trim() && scheduledFor) {
      commentScheduledFor = new Date(scheduledFor.getTime() + 5 * 60 * 1000);
    }

    const created = await this.prisma.linkedInPost.create({
      data: {
        userId,
        topic: dto.topic?.trim() || '',
        content: dto.content,
        status,
        scheduledFor,
        publishedAt,
        firstComment: dto.firstComment?.trim() || '',
        commentScheduledFor,
        commentPosted: dto.commentPosted || false,
        retryCount: dto.retryCount || 0,
        commentRetryCount: dto.commentRetryCount || 0,
        failureReason: dto.failureReason || '',
        tags: dto.tags || [],
        mediaUrls: dto.mediaUrls || [],
        impressions: dto.impressions || 0,
        reactions: dto.reactions || 0,
        comments: dto.comments || 0,
        reposts: dto.reposts || 0,
        postUrl: dto.postUrl?.trim() || '',
        notes: dto.notes?.trim() || '',
      },
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `li_${created.id}`,
        sourceType: 'linkedin',
        sourceId: created.id,
        title: `[LinkedIn] ${created.topic || 'Post #' + created.id}`,
        content: `${created.content} (Status: ${created.status}, Impressions: ${created.impressions || 0})`,
        timestamp: created.createdAt.toISOString(),
      })
      .catch(() => {});

    return created;
  }

  async update(userId: number, id: number, dto: UpdateLinkedInPostDto) {
    const existing = await this.findOne(userId, id);

    const updateData: any = {};
    if (dto.topic !== undefined) updateData.topic = dto.topic.trim();
    if (dto.content !== undefined) updateData.content = dto.content;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.failureReason !== undefined) updateData.failureReason = dto.failureReason;
    if (dto.retryCount !== undefined) updateData.retryCount = Number(dto.retryCount);
    if (dto.commentRetryCount !== undefined) updateData.commentRetryCount = Number(dto.commentRetryCount);
    if (dto.commentPosted !== undefined) updateData.commentPosted = Boolean(dto.commentPosted);

    let targetScheduledFor = existing.scheduledFor;
    if (dto.scheduledFor !== undefined) {
      targetScheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
      updateData.scheduledFor = targetScheduledFor;
    }

    if (dto.publishedAt !== undefined) {
      updateData.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    } else if (dto.status === 'published' && !updateData.publishedAt) {
      updateData.publishedAt = new Date();
    }

    if (dto.firstComment !== undefined) {
      updateData.firstComment = dto.firstComment.trim();
    }

    if (dto.commentScheduledFor !== undefined) {
      if (dto.commentScheduledFor) {
        const commentDate = new Date(dto.commentScheduledFor);
        if (targetScheduledFor && commentDate < targetScheduledFor) {
          updateData.commentScheduledFor = new Date(targetScheduledFor.getTime() + 5 * 60 * 1000);
        } else {
          updateData.commentScheduledFor = commentDate;
        }
      } else {
        updateData.commentScheduledFor = null;
      }
    } else if (targetScheduledFor && updateData.firstComment && !existing.commentScheduledFor) {
      updateData.commentScheduledFor = new Date(targetScheduledFor.getTime() + 5 * 60 * 1000);
    }

    if (dto.tags !== undefined) updateData.tags = dto.tags;
    if (dto.mediaUrls !== undefined) updateData.mediaUrls = dto.mediaUrls;
    if (dto.impressions !== undefined) updateData.impressions = Number(dto.impressions);
    if (dto.reactions !== undefined) updateData.reactions = Number(dto.reactions);
    if (dto.comments !== undefined) updateData.comments = Number(dto.comments);
    if (dto.reposts !== undefined) updateData.reposts = Number(dto.reposts);
    if (dto.postUrl !== undefined) updateData.postUrl = dto.postUrl.trim();
    if (dto.notes !== undefined) updateData.notes = dto.notes.trim();

    const updated = await this.prisma.linkedInPost.update({
      where: { id },
      data: updateData,
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `li_${updated.id}`,
        sourceType: 'linkedin',
        sourceId: updated.id,
        title: `[LinkedIn] ${updated.topic || 'Post #' + updated.id}`,
        content: `${updated.content} (Status: ${updated.status}, Impressions: ${updated.impressions || 0})`,
        timestamp: updated.createdAt.toISOString(),
      })
      .catch(() => {});

    return updated;
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    const deleted = await this.prisma.linkedInPost.delete({
      where: { id },
    });

    // Incremental background vector deletion from Pinecone
    this.pineconeService.deleteMemory(userId, id, 'linkedin').catch(() => {});

    return deleted;
  }
}
