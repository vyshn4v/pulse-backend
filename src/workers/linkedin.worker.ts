import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Worker, Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { getRedisConnectionOpts, BULLMQ_PREFIX } from './redis-connection';

const MAX_PUBLISH_RETRIES = 3;

function getActiveLinkedInVersion(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

interface LinkedInJobData {
  userId: number;
  postId: number;
  type: 'post' | 'comment';
}

@Injectable()
export class LinkedInWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinkedInWorker.name);
  private worker: Worker<LinkedInJobData> | null = null;
  private linkedinQueue: Queue | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
  ) {}

  async onModuleInit() {
    const connection = getRedisConnectionOpts();

    try {
      this.linkedinQueue = new Queue('linkedin-queue', { connection, prefix: BULLMQ_PREFIX });

      this.worker = new Worker<LinkedInJobData>(
        'linkedin-queue',
        async (job: Job<LinkedInJobData>) => {
          this.logger.log(
            `[LinkedIn Consumer Thread] Processing job #${job.id}: ${job.name} (Post #${job.data.postId})`,
          );

          if (job.name === 'publish-post') {
            await this.executePublishPost(job.data.userId, job.data.postId, job.attemptsMade + 1);
          } else if (job.name === 'publish-comment') {
            await this.executePublishComment(job.data.userId, job.data.postId, job.attemptsMade + 1);
          }
        },
        {
          connection,
          prefix: BULLMQ_PREFIX,
          concurrency: 1, // Strict rate limit protection
          useWorkerThreads: true, // Run in isolated background Worker Thread
        },
      );

      this.worker.on('completed', (job) => {
        this.logger.log(`[LinkedIn Consumer Thread] Job #${job.id} (${job.name}) completed successfully.`);
      });

      this.worker.on('failed', async (job, err) => {
        if (!job) return;
        this.logger.error(
          `[LinkedIn Consumer Thread] Job #${job.id} failed on attempt ${job.attemptsMade}/${MAX_PUBLISH_RETRIES}: ${err.message}`,
        );

        if (job.attemptsMade >= MAX_PUBLISH_RETRIES) {
          await this.handleFinalFailure(job.data.userId, job.data.postId, job.name, err.message);
        } else {
          // Re-mark status as scheduled with current retry count for visibility
          if (job.name === 'publish-post') {
            await this.prisma.linkedInPost
              .update({
                where: { id: job.data.postId },
                data: {
                  status: 'scheduled',
                  retryCount: job.attemptsMade,
                  failureReason: `Attempt ${job.attemptsMade} failed: ${err.message}`,
                },
              })
              .catch(() => {});
          } else if (job.name === 'publish-comment') {
            await this.prisma.linkedInPost
              .update({
                where: { id: job.data.postId },
                data: {
                  commentRetryCount: job.attemptsMade,
                },
              })
              .catch(() => {});
          }
        }
      });

      this.logger.log('LinkedIn Publishing Worker initialized on isolated background Worker Thread.');
    } catch (err: any) {
      this.logger.warn(`Could not initialize LinkedIn Worker: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
    }
    if (this.linkedinQueue) {
      await this.linkedinQueue.close();
    }
  }

  private async executePublishPost(userId: number, postId: number, attempt: number) {
    const post = await this.prisma.linkedInPost.findUnique({
      where: { id: postId },
      include: { user: true },
    });

    if (!post) throw new Error(`Post #${postId} not found`);

    const user = post.user;
    const accessToken = user?.linkedinAccessToken || process.env.LINKEDIN_ACCESS_TOKEN?.trim();
    const memberUrn = user?.linkedinMemberUrn || process.env.LINKEDIN_MEMBER_URN?.trim();

    if (!accessToken) {
      throw new Error('Missing LinkedIn credentials / token');
    }

    let fullCommentary = post.content.trim();
    if (post.tags && post.tags.length > 0) {
      const missingTags = post.tags.filter((t) => !fullCommentary.includes(t));
      if (missingTags.length > 0) {
        fullCommentary += '\n\n' + missingTags.join(' ');
      }
    }

    let resolvedAuthor = memberUrn;
    if (!resolvedAuthor || resolvedAuthor === 'urn:li:person:configured') {
      try {
        const uRes = await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (uRes.ok) {
          const uJson = await uRes.json();
          resolvedAuthor = `urn:li:person:${uJson.sub}`;
        }
      } catch {}
    }

    if (!resolvedAuthor) resolvedAuthor = 'urn:li:person:self';

    const payload = {
      author: resolvedAuthor,
      commentary: fullCommentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    const currentVersion = getActiveLinkedInVersion();
    let postUrn = '';
    let restErrorText = '';

    // 1. Try modern LinkedIn /rest/posts with active version
    try {
      const response = await fetch('https://api.linkedin.com/rest/posts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': currentVersion,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok || response.status === 201) {
        postUrn = response.headers.get('x-restli-id') || '';
      } else {
        restErrorText = await response.text();
        this.logger.warn(
          `LinkedIn rest/posts (version ${currentVersion}) returned ${response.status}: ${restErrorText}. Falling back to v2/ugcPosts...`,
        );
      }
    } catch (err: any) {
      restErrorText = err.message;
      this.logger.warn(`LinkedIn rest/posts network exception: ${err.message}. Falling back to v2/ugcPosts...`);
    }

    // 2. Fallback to v2/ugcPosts (version-independent) if rest/posts failed
    if (!postUrn) {
      const ugcPayload = {
        author: resolvedAuthor,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: fullCommentary },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };

      const ugcRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ugcPayload),
      });

      if (ugcRes.ok || ugcRes.status === 201) {
        const ugcData = await ugcRes.json().catch(() => ({}));
        postUrn = ugcData.id || ugcRes.headers.get('x-restli-id') || '';
      } else {
        const ugcErr = await ugcRes.text();
        throw new Error(
          `LinkedIn API rejected post. REST (/rest/posts) error: ${restErrorText} | UGC (/v2/ugcPosts) error: ${ugcErr}`,
        );
      }
    }

    const postUrl = postUrn
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}`
      : 'https://www.linkedin.com/feed/';

    await this.prisma.linkedInPost.update({
      where: { id: postId },
      data: {
        status: 'published',
        publishedAt: new Date(),
        linkedinUrn: postUrn,
        retryCount: 0,
        failureReason: '',
        postUrl,
      },
    });

    this.logger.log(`[LinkedIn Consumer] Post #${postId} published live successfully (${postUrn})`);

    // Alert user through Queued Mail
    if (user?.email) {
      await this.mailService
        .sendPostPublishedAlert(
          user.email,
          post.topic || post.content.slice(0, 50),
          postUrl,
          postId,
        )
        .catch((err) => {
          this.logger.warn(`Could not dispatch post published email alert: ${err.message}`);
        });
    }

    // Enqueue 1st Comment if scheduled
    if (post.firstComment?.trim() && this.linkedinQueue) {
      let delayMs = 0;
      if (post.commentScheduledFor) {
        delayMs = Math.max(0, new Date(post.commentScheduledFor).getTime() - Date.now());
      }

      await this.linkedinQueue.add(
        'publish-comment',
        { userId, postId, type: 'comment' },
        { delay: delayMs, jobId: `comment-${postId}-${Date.now()}` },
      );
      this.logger.log(
        `[LinkedIn Consumer] 1st Comment queued for post #${postId} with delay ${Math.round(delayMs / 1000)}s`,
      );
    }
  }

  private async executePublishComment(userId: number, postId: number, attempt: number) {
    const post = await this.prisma.linkedInPost.findUnique({
      where: { id: postId },
      include: { user: true },
    });

    if (!post || !post.firstComment || post.commentPosted || !post.linkedinUrn) {
      return;
    }

    const user = post.user;
    const accessToken = user?.linkedinAccessToken || process.env.LINKEDIN_ACCESS_TOKEN?.trim();
    const memberUrn = user?.linkedinMemberUrn || process.env.LINKEDIN_MEMBER_URN?.trim();

    if (!accessToken) return;

    let resolvedActor = memberUrn;
    if (!resolvedActor || resolvedActor === 'urn:li:person:configured') {
      try {
        const uRes = await fetch('https://api.linkedin.com/v2/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (uRes.ok) {
          const uJson = await uRes.json();
          resolvedActor = `urn:li:person:${uJson.sub}`;
        }
      } catch {}
    }

    if (!resolvedActor) resolvedActor = 'urn:li:person:self';

    const encodedUrn = encodeURIComponent(post.linkedinUrn);
    const commentPayload = {
      actor: resolvedActor,
      message: { text: post.firstComment.trim() },
    };

    let success = false;

    const currentVersion = getActiveLinkedInVersion();
    let commentErrorText = '';

    // 1. Try REST API
    try {
      const res = await fetch(`https://api.linkedin.com/rest/socialActions/${encodedUrn}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'LinkedIn-Version': currentVersion,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commentPayload),
      });

      if (res.ok || res.status === 201) {
        success = true;
      } else {
        commentErrorText = await res.text();
        this.logger.warn(
          `LinkedIn rest comments (version ${currentVersion}) returned ${res.status}: ${commentErrorText}. Falling back to v2/socialActions...`,
        );
      }
    } catch (err: any) {
      commentErrorText = err.message;
    }

    if (!success) {
      // 2. Fallback to v2 socialActions
      const v2Payload = {
        actor: resolvedActor,
        object: post.linkedinUrn,
        message: { text: post.firstComment.trim() },
      };

      const v2Res = await fetch(`https://api.linkedin.com/v2/socialActions/${encodedUrn}/comments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Restli-Protocol-Version': '2.0.0',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(v2Payload),
      });

      if (v2Res.ok || v2Res.status === 201) {
        success = true;
      } else {
        const errTxt = await v2Res.text();
        throw new Error(`LinkedIn comments API rejected: ${commentErrorText || errTxt} (v2 fallback: ${errTxt})`);
      }
    }

    if (success) {
      await this.prisma.linkedInPost.update({
        where: { id: postId },
        data: {
          commentPosted: true,
          commentPublishedAt: new Date(),
          commentRetryCount: 0,
        },
      });
      this.logger.log(`[LinkedIn Consumer] 1st Comment published live on post #${postId}`);
    }
  }

  private async handleFinalFailure(userId: number, postId: number, jobType: string, errorMsg: string) {
    this.logger.error(`[LinkedIn Consumer] Job ${jobType} for post #${postId} failed after ${MAX_PUBLISH_RETRIES} attempts`);

    const post = await this.prisma.linkedInPost.findFirst({
      where: { id: postId },
      include: { user: true },
    });

    if (!post) return;

    await this.prisma.linkedInPost.update({
      where: { id: postId },
      data: {
        status: 'review',
        failureReason: `${jobType === 'publish-comment' ? '1st Comment' : 'Post'} failed after ${MAX_PUBLISH_RETRIES} attempts: ${errorMsg}`,
      },
    });

    // Alert user through Queued Mail
    await this.mailService.sendPostFailedAlert(
      post.user.email,
      post.topic || post.content.slice(0, 40),
      errorMsg,
      postId,
    );

    if (
      errorMsg.toLowerCase().includes('expired') ||
      errorMsg.toLowerCase().includes('401') ||
      errorMsg.toLowerCase().includes('unauthorized') ||
      errorMsg.toLowerCase().includes('revoked')
    ) {
      await this.mailService.sendTokenExpiredAlert(post.user.email);
    }
  }
}
