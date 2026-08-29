import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PineconeService } from '../pinecone/pinecone.service';
import {
  CreateMediumPostDto,
  UpdateMediumPostDto,
  PublicPostsQueryDto,
} from './medium.dto';

@Injectable()
export class MediumService {
  private readonly logger = new Logger(MediumService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pineconeService: PineconeService,
  ) {}

  // ---------------------------------------------------------------------------
  // Authenticated Admin Operations
  // ---------------------------------------------------------------------------

  async findAll(
    userId: number,
    filter?: {
      status?: string; // 'all' | 'visible' | 'hidden' | 'featured'
      tag?: string;
      search?: string;
    },
  ) {
    const where: any = { userId };

    if (filter?.status === 'visible') {
      where.isHidden = false;
    } else if (filter?.status === 'hidden') {
      where.isHidden = true;
    } else if (filter?.status === 'featured') {
      where.isFeatured = true;
    }

    if (filter?.tag && filter.tag !== 'all') {
      where.tags = { has: filter.tag };
    }

    if (filter?.search && filter.search.trim() !== '') {
      const q = filter.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { subtitle: { contains: q, mode: 'insensitive' } },
        { url: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.mediumPost.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async getStats(userId: number) {
    const allPosts = await this.prisma.mediumPost.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        isHidden: true,
        isFeatured: true,
        claps: true,
        tags: true,
        publishedAt: true,
      },
      orderBy: { publishedAt: 'desc' },
    });

    const total = allPosts.length;
    const visibleCount = allPosts.filter((p) => !p.isHidden).length;
    const hiddenCount = allPosts.filter((p) => p.isHidden).length;
    const featuredCount = allPosts.filter((p) => p.isFeatured).length;
    const totalClaps = allPosts.reduce((sum, p) => sum + (p.claps || 0), 0);

    // Tag frequency
    const tagCountMap: Record<string, number> = {};
    allPosts.forEach((post) => {
      post.tags.forEach((tag) => {
        tagCountMap[tag] = (tagCountMap[tag] || 0) + 1;
      });
    });

    const topTags = Object.entries(tagCountMap)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mediumUsername: true },
    });

    return {
      total,
      visibleCount,
      hiddenCount,
      featuredCount,
      totalClaps,
      topTags,
      mediumUsername: user?.mediumUsername || '',
      latestPost: allPosts[0] || null,
    };
  }

  async updateMediumUsername(userId: number, rawUsername: string) {
    const cleanUsername = (rawUsername || '')
      .trim()
      .replace(/^https?:\/\/(www\.)?medium\.com\/@?/i, '')
      .replace(/^@/, '')
      .replace(/\/.*$/, '');

    await this.prisma.user.update({
      where: { id: userId },
      data: { mediumUsername: cleanUsername },
    });

    return { success: true, mediumUsername: cleanUsername };
  }

  async findOne(userId: number, id: number) {
    const post = await this.prisma.mediumPost.findFirst({
      where: { id, userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException(`Medium post #${id} not found`);
    }

    return post;
  }

  async create(userId: number, dto: CreateMediumPostDto) {
    if (!dto.title || dto.title.trim() === '') {
      throw new BadRequestException('Title is required');
    }
    if (!dto.url || dto.url.trim() === '') {
      throw new BadRequestException('Medium article URL is required');
    }

    const publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : new Date();

    const created = await this.prisma.mediumPost.create({
      data: {
        userId,
        title: dto.title.trim(),
        url: dto.url.trim(),
        subtitle: dto.subtitle?.trim() || '',
        coverImage: dto.coverImage?.trim() || '',
        tags: Array.isArray(dto.tags) ? dto.tags.map((t) => t.trim()).filter(Boolean) : [],
        publishedAt,
        readingTimeMinutes: Number(dto.readingTimeMinutes) || 5,
        claps: Number(dto.claps) || 0,
        responsesCount: Number(dto.responsesCount) || 0,
        canonicalUrl: dto.canonicalUrl?.trim() || '',
        isHidden: Boolean(dto.isHidden),
        isFeatured: Boolean(dto.isFeatured),
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `medium_${created.id}`,
        sourceType: 'medium_post',
        sourceId: created.id,
        title: `[Medium Post] ${created.title}`,
        content: `Medium Article: "${created.title}". ${created.subtitle || ''}. Tags: ${created.tags.join(', ')}. URL: ${created.url}`,
        timestamp: created.publishedAt.toISOString(),
      })
      .catch((err) => {
        this.logger.warn(`Failed to index Medium post #${created.id} into Pinecone: ${err?.message}`);
      });

    return created;
  }

  async batchCreate(userId: number, articles: CreateMediumPostDto[]) {
    if (!Array.isArray(articles) || articles.length === 0) {
      throw new BadRequestException('No articles provided for batch import');
    }

    const createdList: any[] = [];

    for (const dto of articles) {
      if (!dto.title || !dto.url) continue;

      const cleanUrl = dto.url.split('?')[0].replace(/\/+$/, '');

      // Check if already exists for this user
      const existing = await this.prisma.mediumPost.findFirst({
        where: {
          userId,
          OR: [
            { url: { contains: cleanUrl, mode: 'insensitive' } },
            { title: { equals: dto.title.trim(), mode: 'insensitive' } },
          ],
        },
      });

      if (!existing) {
        const publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : new Date();
        const created = await this.prisma.mediumPost.create({
          data: {
            userId,
            title: dto.title.trim(),
            url: cleanUrl,
            subtitle: dto.subtitle?.trim() || '',
            coverImage: dto.coverImage?.trim() || '',
            tags: Array.isArray(dto.tags) ? dto.tags.map((t) => t.trim()).filter(Boolean) : [],
            publishedAt,
            readingTimeMinutes: Number(dto.readingTimeMinutes) || 5,
            claps: Number(dto.claps) || 0,
            responsesCount: Number(dto.responsesCount) || 0,
            canonicalUrl: cleanUrl,
            isHidden: false,
            isFeatured: false,
          },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatarUrl: true,
              },
            },
          },
        });

        // Background vectorization to Pinecone
        this.pineconeService
          .upsertMemory(userId, {
            id: `medium_${created.id}`,
            sourceType: 'medium_post',
            sourceId: created.id,
            title: `[Medium Post] ${created.title}`,
            content: `Medium Article: "${created.title}". ${created.subtitle || ''}. Tags: ${created.tags.join(', ')}. URL: ${created.url}`,
            timestamp: created.publishedAt.toISOString(),
          })
          .catch(() => {});

        createdList.push(created);
      }
    }

    return {
      success: true,
      importedCount: createdList.length,
      posts: createdList,
    };
  }

  async update(userId: number, id: number, dto: UpdateMediumPostDto) {
    const existing = await this.findOne(userId, id);

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.url !== undefined) data.url = dto.url.trim();
    if (dto.subtitle !== undefined) data.subtitle = dto.subtitle.trim();
    if (dto.coverImage !== undefined) data.coverImage = dto.coverImage.trim();
    if (dto.tags !== undefined) {
      data.tags = Array.isArray(dto.tags) ? dto.tags.map((t) => t.trim()).filter(Boolean) : [];
    }
    if (dto.publishedAt !== undefined) data.publishedAt = new Date(dto.publishedAt);
    if (dto.readingTimeMinutes !== undefined) data.readingTimeMinutes = Number(dto.readingTimeMinutes) || 0;
    if (dto.claps !== undefined) data.claps = Number(dto.claps) || 0;
    if (dto.responsesCount !== undefined) data.responsesCount = Number(dto.responsesCount) || 0;
    if (dto.canonicalUrl !== undefined) data.canonicalUrl = dto.canonicalUrl.trim();
    if (dto.isHidden !== undefined) data.isHidden = Boolean(dto.isHidden);
    if (dto.isFeatured !== undefined) data.isFeatured = Boolean(dto.isFeatured);

    const updated = await this.prisma.mediumPost.update({
      where: { id },
      data,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    // Re-index into Pinecone
    this.pineconeService
      .upsertMemory(userId, {
        id: `medium_${updated.id}`,
        sourceType: 'medium_post',
        sourceId: updated.id,
        title: `[Medium Post] ${updated.title}`,
        content: `Medium Article: "${updated.title}". ${updated.subtitle || ''}. Tags: ${updated.tags.join(', ')}. URL: ${updated.url}`,
        timestamp: updated.publishedAt.toISOString(),
      })
      .catch(() => {});

    return updated;
  }

  async toggleVisibility(userId: number, id: number) {
    const existing = await this.findOne(userId, id);
    const updated = await this.prisma.mediumPost.update({
      where: { id },
      data: {
        isHidden: !existing.isHidden,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });
    return updated;
  }

  async toggleFeatured(userId: number, id: number) {
    const existing = await this.findOne(userId, id);
    const updated = await this.prisma.mediumPost.update({
      where: { id },
      data: {
        isFeatured: !existing.isFeatured,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });
    return updated;
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    const deleted = await this.prisma.mediumPost.delete({
      where: { id },
    });

    // Incremental background vector deletion from Pinecone
    this.pineconeService.deleteMemory(userId, id, 'medium_post').catch(() => {});

    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Auto-Scraper & RSS Parser for Medium Articles
  // ---------------------------------------------------------------------------

  async fetchMetadataFromUrl(rawUrl: string) {
    if (!rawUrl || !rawUrl.startsWith('http')) {
      throw new BadRequestException('A valid HTTP/HTTPS URL is required');
    }

    const cleanUrl = rawUrl.split('?')[0].replace(/\/+$/, '');

    // Strategy 1: Medium RSS Feed Parser (Bypasses Cloudflare bot blocks)
    try {
      const userMatch =
        cleanUrl.match(/medium\.com\/@([a-zA-Z0-9_.-]+)/) ||
        cleanUrl.match(/([a-zA-Z0-9_.-]+)\.medium\.com/);

      if (userMatch && userMatch[1]) {
        const username = userMatch[1].replace(/^@/, '');
        const rssFeedUrl = `https://medium.com/feed/@${username}`;

        const feedRes = await fetch(rssFeedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; PULSE-Bot/3.0; +https://vyshnavpc.com)',
            Accept: 'application/rss+xml, application/xml, text/xml, */*',
          },
        });

        if (feedRes.ok) {
          const xml = await feedRes.text();
          const items = xml.split('<item>').slice(1);

          // Extract post ID from clean URL (last 10-14 hex characters or slug)
          const postIdMatch = cleanUrl.match(/[a-f0-9]{10,14}$/i);
          const postId = postIdMatch ? postIdMatch[0].toLowerCase() : null;
          const urlSlug = cleanUrl.split('/').pop() || '';

          for (const itemXml of items) {
            const linkMatch = itemXml.match(/<link>([^<]+)<\/link>/);
            const guidMatch = itemXml.match(/<guid[^>]*>([^<]+)<\/guid>/);
            const itemLink = linkMatch ? linkMatch[1].split('?')[0].replace(/\/+$/, '') : '';
            const guid = guidMatch ? guidMatch[1] : '';

            const isMatch =
              itemLink === cleanUrl ||
              (postId && (itemLink.toLowerCase().includes(postId) || guid.toLowerCase().includes(postId))) ||
              (urlSlug && itemLink.includes(urlSlug));

            if (isMatch) {
              const titleMatch =
                itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                itemXml.match(/<title>([^<]+)<\/title>/);
              const title = titleMatch ? this.cleanHtmlEntities(titleMatch[1].trim()) : '';

              const imgMatch = itemXml.match(/<img[^>]+src=["']([^"']+)["']/i);
              const coverImage = imgMatch ? imgMatch[1] : '';

              const categories = Array.from(
                itemXml.matchAll(/<category><!\[CDATA\[([\s\S]*?)\]\]><\/category>/g),
              ).map((m) => m[1].trim());

              const pubDateMatch = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/);
              const contentMatch = itemXml.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/);
              const content = contentMatch ? contentMatch[1] : '';

              // First non-empty paragraph
              const pMatch = content.match(/<p>([\s\S]*?)<\/p>/);
              let subtitle = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : '';
              if (subtitle.length > 280) {
                subtitle = subtitle.slice(0, 277) + '...';
              }

              // Compute reading time (~200 wpm)
              const plainWords = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
              const readingTimeMinutes = Math.max(1, Math.round(plainWords / 200)) || 5;

              return {
                success: true,
                title,
                subtitle,
                coverImage,
                canonicalUrl: cleanUrl,
                readingTimeMinutes,
                publishedAt: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString(),
                tags: categories.slice(0, 6),
              };
            }
          }
        }
      }
    } catch (err: any) {
      this.logger.debug(`RSS feed strategy bypassed: ${err?.message}`);
    }

    // Strategy 2: Direct HTTP Fetch with Realistic Chrome Browser Headers
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(rawUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const html = await response.text();

        const getMetaContent = (property: string): string => {
          const patterns = [
            new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
            new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'),
            new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
            new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["']`, 'i'),
          ];
          for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
              return this.cleanHtmlEntities(match[1].trim());
            }
          }
          return '';
        };

        let title = getMetaContent('og:title') || getMetaContent('twitter:title');
        if (!title) {
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          if (titleMatch && titleMatch[1]) {
            title = this.cleanHtmlEntities(titleMatch[1].trim());
          }
        }
        title = title.replace(/\s*\|\s*by\s+.*$/i, '').replace(/\s*\|\s*Medium$/i, '').replace(/\s*-\s*Medium$/i, '').trim();

        let subtitle =
          getMetaContent('og:description') ||
          getMetaContent('description') ||
          getMetaContent('twitter:description');

        let coverImage = getMetaContent('og:image') || getMetaContent('twitter:image');

        let readingTimeMinutes = 5;
        const readingTimeStr = getMetaContent('twitter:data1');
        if (readingTimeStr && /\d+/.test(readingTimeStr)) {
          const num = parseInt(readingTimeStr.match(/\d+/)![0], 10);
          if (num > 0 && num < 120) readingTimeMinutes = num;
        }

        let publishedAt: string | null = getMetaContent('article:published_time');
        const tags: string[] = [];
        const keywords = getMetaContent('keywords') || getMetaContent('news_keywords');
        if (keywords) {
          keywords.split(',').forEach((k) => {
            const clean = k.trim();
            if (clean && clean.length < 30 && !['Medium', 'blog', 'article'].includes(clean)) {
              tags.push(clean);
            }
          });
        }

        if (title) {
          return {
            success: true,
            title,
            subtitle: subtitle || '',
            coverImage: coverImage || '',
            canonicalUrl: cleanUrl,
            readingTimeMinutes,
            publishedAt: publishedAt || new Date().toISOString(),
            tags: tags.slice(0, 5),
          };
        }
      }
    } catch (err: any) {
      this.logger.debug(`Direct fetch failed: ${err?.message}`);
    }

    // Strategy 3: Graceful URL Slug Parsing (Zero-failure fallback)
    const slug = cleanUrl.split('/').pop() || '';
    const cleanSlug = slug.replace(/-[a-f0-9]{10,14}$/i, '');
    const titleFromSlug = cleanSlug
      .split('-')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    const detectedTags: string[] = [];
    const lowerSlug = cleanSlug.toLowerCase();
    if (lowerSlug.includes('node')) detectedTags.push('Node.js');
    if (lowerSlug.includes('javascript') || lowerSlug.includes('js')) detectedTags.push('JavaScript');
    if (lowerSlug.includes('react')) detectedTags.push('React');
    if (lowerSlug.includes('typescript') || lowerSlug.includes('ts')) detectedTags.push('TypeScript');
    if (lowerSlug.includes('event-loop') || lowerSlug.includes('async')) detectedTags.push('Event Loop');
    if (lowerSlug.includes('redis')) detectedTags.push('Redis');
    if (lowerSlug.includes('websocket') || lowerSlug.includes('sse')) detectedTags.push('WebSockets');

    return {
      success: true,
      title: titleFromSlug || 'Medium Article',
      subtitle: '',
      coverImage: '',
      canonicalUrl: cleanUrl,
      readingTimeMinutes: 5,
      publishedAt: new Date().toISOString(),
      tags: detectedTags.length > 0 ? detectedTags : ['Engineering', 'Architecture'],
    };
  }

  /**
   * Fetch all recent articles from an author's Medium RSS feed for 1-click batch import
   */
  async fetchAuthorFeed(authorHandle: string) {
    const cleanHandle = authorHandle.trim().replace(/^@/, '');
    if (!cleanHandle) {
      throw new BadRequestException('Medium author handle is required');
    }

    const rssFeedUrl = `https://medium.com/feed/@${cleanHandle}`;
    const feedRes = await fetch(rssFeedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; PULSE-Bot/3.0; +https://vyshnavpc.com)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
    });

    if (!feedRes.ok) {
      throw new BadRequestException(`Could not find Medium feed for @${cleanHandle} (HTTP ${feedRes.status})`);
    }

    const xml = await feedRes.text();
    const items = xml.split('<item>').slice(1);
    const parsedArticles: any[] = [];

    for (const itemXml of items) {
      const linkMatch = itemXml.match(/<link>([^<]+)<\/link>/);
      const titleMatch =
        itemXml.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
        itemXml.match(/<title>([^<]+)<\/title>/);
      const imgMatch = itemXml.match(/<img[^>]+src=["']([^"']+)["']/i);
      const categories = Array.from(
        itemXml.matchAll(/<category><!\[CDATA\[([\s\S]*?)\]\]><\/category>/g),
      ).map((m) => m[1].trim());
      const pubDateMatch = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/);
      const contentMatch = itemXml.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/);
      const content = contentMatch ? contentMatch[1] : '';

      const pMatch = content.match(/<p>([\s\S]*?)<\/p>/);
      let subtitle = pMatch ? pMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (subtitle.length > 250) {
        subtitle = subtitle.slice(0, 247) + '...';
      }

      const plainWords = content.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      const readingTimeMinutes = Math.max(1, Math.round(plainWords / 200)) || 5;

      const url = linkMatch ? linkMatch[1].split('?')[0].replace(/\/+$/, '') : '';
      const title = titleMatch ? this.cleanHtmlEntities(titleMatch[1].trim()) : '';

      if (title && url) {
        parsedArticles.push({
          title,
          url,
          subtitle,
          coverImage: imgMatch ? imgMatch[1] : '',
          tags: categories,
          publishedAt: pubDateMatch ? new Date(pubDateMatch[1]).toISOString() : new Date().toISOString(),
          readingTimeMinutes,
        });
      }
    }

    return {
      success: true,
      handle: cleanHandle,
      count: parsedArticles.length,
      articles: parsedArticles,
    };
  }

  private cleanHtmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');
  }

  // ---------------------------------------------------------------------------
  // Public Open Portfolio API (Unauthenticated, strictly excludes hidden posts)
  // ---------------------------------------------------------------------------

  async findPublicPosts(query?: PublicPostsQueryDto) {
    const where: any = {
      isHidden: false, // CRITICAL: Exclude all hidden / disabled posts
    };

    if (query?.tag && query.tag !== 'all') {
      where.tags = { has: query.tag };
    }

    if (query?.featured !== undefined) {
      where.isFeatured = Boolean(query.featured);
    }

    if (query?.status === 'featured') {
      where.isFeatured = true;
    }

    const orderBy: any = {};
    if (query?.sort === 'popular') {
      orderBy.claps = 'desc';
    } else {
      orderBy.publishedAt = 'desc';
    }

    const limit = query?.limit ? Math.min(Math.max(1, Number(query.limit)), 100) : undefined;

    const [posts, totalVisible] = await Promise.all([
      this.prisma.mediumPost.findMany({
        where,
        orderBy,
        take: limit,
        select: {
          id: true,
          title: true,
          url: true,
          subtitle: true,
          coverImage: true,
          tags: true,
          publishedAt: true,
          readingTimeMinutes: true,
          claps: true,
          responsesCount: true,
          canonicalUrl: true,
          isFeatured: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.mediumPost.count({ where: { isHidden: false } }),
    ]);

    return {
      success: true,
      count: posts.length,
      totalVisible,
      posts,
      metadata: {
        timestamp: new Date().toISOString(),
        filterApplied: {
          tag: query?.tag || null,
          sort: query?.sort || 'latest',
          limit: limit || 'all',
          featuredOnly: query?.featured || false,
          status: query?.status || null,
        },
      },
    };
  }

  async findPublicOne(id: number) {
    const post = await this.prisma.mediumPost.findFirst({
      where: {
        id,
        isHidden: false, // CRITICAL: Only visible if not hidden
      },
      select: {
        id: true,
        title: true,
        url: true,
        subtitle: true,
        coverImage: true,
        tags: true,
        publishedAt: true,
        readingTimeMinutes: true,
        claps: true,
        responsesCount: true,
        canonicalUrl: true,
        isFeatured: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!post) {
      throw new NotFoundException(`Public Medium post #${id} not found or is private`);
    }

    return {
      success: true,
      post,
    };
  }
}
