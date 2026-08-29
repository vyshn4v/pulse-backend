import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PineconeService } from '../pinecone/pinecone.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  PublicProjectsQueryDto,
} from './projects.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

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
      status?: string; // 'all' | 'active' | 'completed' | 'archived' | 'paused'
      category?: string;
      techStack?: string;
      search?: string;
    },
  ) {
    const where: any = { userId };

    if (filter?.status && filter.status !== 'all') {
      where.status = filter.status;
    }

    if (filter?.category && filter.category !== 'all') {
      where.category = filter.category;
    }

    if (filter?.techStack && filter.techStack !== 'all') {
      where.techStack = { has: filter.techStack };
    }

    if (filter?.search && filter.search.trim() !== '') {
      const q = filter.search.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { repoUrl: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.project.findMany({
      where,
      orderBy: { startDate: 'desc' },
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
    const allProjects = await this.prisma.project.findMany({
      where: { userId },
      select: {
        id: true,
        title: true,
        isHidden: true,
        isFeatured: true,
        status: true,
        category: true,
        techStack: true,
        startDate: true,
      },
      orderBy: { startDate: 'desc' },
    });

    const total = allProjects.length;
    const activeCount = allProjects.filter((p) => p.status === 'active').length;
    const completedCount = allProjects.filter((p) => p.status === 'completed').length;
    const archivedCount = allProjects.filter((p) => p.status === 'archived').length;
    const pausedCount = allProjects.filter((p) => p.status === 'paused').length;
    const featuredCount = allProjects.filter((p) => p.isFeatured).length;
    const visibleCount = allProjects.filter((p) => !p.isHidden).length;
    const hiddenCount = allProjects.filter((p) => p.isHidden).length;

    // Tech stack frequency
    const techCountMap: Record<string, number> = {};
    allProjects.forEach((project) => {
      project.techStack.forEach((tech) => {
        techCountMap[tech] = (techCountMap[tech] || 0) + 1;
      });
    });

    const topTechStack = Object.entries(techCountMap)
      .sort((a, b) => b[1] - a[1])
      .map(([tech, count]) => ({ tech, count }));

    // Category breakdown
    const categoryMap: Record<string, number> = {};
    allProjects.forEach((project) => {
      categoryMap[project.category] = (categoryMap[project.category] || 0) + 1;
    });

    return {
      total,
      activeCount,
      completedCount,
      archivedCount,
      pausedCount,
      featuredCount,
      visibleCount,
      hiddenCount,
      topTechStack,
      categoryBreakdown: categoryMap,
      latestProject: allProjects[0] || null,
    };
  }

  async findOne(userId: number, id: number) {
    const project = await this.prisma.project.findFirst({
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

    if (!project) {
      throw new NotFoundException(`Project #${id} not found`);
    }

    return project;
  }

  async create(userId: number, dto: CreateProjectDto) {
    if (!dto.title || dto.title.trim() === '') {
      throw new BadRequestException('Project title is required');
    }

    const startDate = dto.startDate ? new Date(dto.startDate) : new Date();

    const created = await this.prisma.project.create({
      data: {
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim() || '',
        repoUrl: dto.repoUrl?.trim() || '',
        liveUrl: dto.liveUrl?.trim() || '',
        coverImage: dto.coverImage?.trim() || '',
        techStack: Array.isArray(dto.techStack) ? dto.techStack.map((t) => t.trim()).filter(Boolean) : [],
        category: dto.category?.trim() || 'personal',
        status: dto.status?.trim() || 'active',
        startDate,
        endDate: dto.endDate ? new Date(dto.endDate) : null,
        isHidden: Boolean(dto.isHidden),
        isFeatured: Boolean(dto.isFeatured),
        highlights: Array.isArray(dto.highlights) ? dto.highlights.map((h) => h.trim()).filter(Boolean) : [],
        metrics: dto.metrics || {},
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
        id: `project_${created.id}`,
        sourceType: 'project',
        sourceId: created.id,
        title: `[Project] ${created.title}`,
        content: `Project: "${created.title}". ${created.description || ''}. Tech: ${created.techStack.join(', ')}. Category: ${created.category}. Status: ${created.status}`,
        timestamp: created.startDate.toISOString(),
      })
      .catch((err) => {
        this.logger.warn(`Failed to index Project #${created.id} into Pinecone: ${err?.message}`);
      });

    return created;
  }

  async update(userId: number, id: number, dto: UpdateProjectDto) {
    const existing = await this.findOne(userId, id);

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) data.description = dto.description.trim();
    if (dto.repoUrl !== undefined) data.repoUrl = dto.repoUrl.trim();
    if (dto.liveUrl !== undefined) data.liveUrl = dto.liveUrl.trim();
    if (dto.coverImage !== undefined) data.coverImage = dto.coverImage.trim();
    if (dto.techStack !== undefined) {
      data.techStack = Array.isArray(dto.techStack) ? dto.techStack.map((t) => t.trim()).filter(Boolean) : [];
    }
    if (dto.category !== undefined) data.category = dto.category.trim();
    if (dto.status !== undefined) data.status = dto.status.trim();
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.isHidden !== undefined) data.isHidden = Boolean(dto.isHidden);
    if (dto.isFeatured !== undefined) data.isFeatured = Boolean(dto.isFeatured);
    if (dto.highlights !== undefined) {
      data.highlights = Array.isArray(dto.highlights) ? dto.highlights.map((h) => h.trim()).filter(Boolean) : [];
    }
    if (dto.metrics !== undefined) data.metrics = dto.metrics || {};

    const updated = await this.prisma.project.update({
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
        id: `project_${updated.id}`,
        sourceType: 'project',
        sourceId: updated.id,
        title: `[Project] ${updated.title}`,
        content: `Project: "${updated.title}". ${updated.description || ''}. Tech: ${updated.techStack.join(', ')}. Category: ${updated.category}. Status: ${updated.status}`,
        timestamp: updated.startDate.toISOString(),
      })
      .catch(() => {});

    return updated;
  }

  async toggleVisibility(userId: number, id: number) {
    const existing = await this.findOne(userId, id);
    const updated = await this.prisma.project.update({
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
    const updated = await this.prisma.project.update({
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
    const deleted = await this.prisma.project.delete({
      where: { id },
    });

    // Incremental background vector deletion from Pinecone
    this.pineconeService.deleteMemory(userId, id, 'project').catch(() => {});

    return deleted;
  }

  // ---------------------------------------------------------------------------
  // Public Open Portfolio API (Unauthenticated, strictly excludes hidden projects)
  // ---------------------------------------------------------------------------

  async findPublicProjects(query?: PublicProjectsQueryDto) {
    const where: any = {
      isHidden: false, // CRITICAL: Exclude all hidden projects
    };

    if (query?.category && query.category !== 'all') {
      where.category = query.category;
    }

    if (query?.techStack && query.techStack !== 'all') {
      where.techStack = { has: query.techStack };
    }

    if (query?.featured !== undefined) {
      where.isFeatured = Boolean(query.featured);
    }

    if (query?.status && query.status !== 'all') {
      where.status = query.status;
    }

    const orderBy: any = {};
    if (query?.sort === 'popular') {
      orderBy.isFeatured = 'desc';
    } else {
      orderBy.startDate = 'desc';
    }

    const limit = query?.limit ? Math.min(Math.max(1, Number(query.limit)), 100) : undefined;

    const [projects, totalVisible] = await Promise.all([
      this.prisma.project.findMany({
        where,
        orderBy,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          repoUrl: true,
          liveUrl: true,
          coverImage: true,
          techStack: true,
          category: true,
          status: true,
          startDate: true,
          endDate: true,
          isFeatured: true,
          highlights: true,
          metrics: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.project.count({ where: { isHidden: false } }),
    ]);

    return {
      success: true,
      count: projects.length,
      totalVisible,
      projects,
      metadata: {
        timestamp: new Date().toISOString(),
        filterApplied: {
          category: query?.category || null,
          techStack: query?.techStack || null,
          sort: query?.sort || 'latest',
          limit: limit || 'all',
          featuredOnly: query?.featured || false,
          status: query?.status || null,
        },
      },
    };
  }

  async findPublicOne(id: number) {
    const project = await this.prisma.project.findFirst({
      where: {
        id,
        isHidden: false, // CRITICAL: Only visible if not hidden
      },
      select: {
        id: true,
        title: true,
        description: true,
        repoUrl: true,
        liveUrl: true,
        coverImage: true,
        techStack: true,
        category: true,
        status: true,
        startDate: true,
        endDate: true,
        isFeatured: true,
        highlights: true,
        metrics: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!project) {
      throw new NotFoundException(`Public Project #${id} not found or is private`);
    }

    return {
      success: true,
      project,
    };
  }

  /**
   * Fetch all active, visible projects for the public portfolio API
   * GET /api/public/projects/active
   */
  async getActiveProjects() {
    const projects = await this.prisma.project.findMany({
      where: {
        isHidden: false,
        status: 'active',
      },
      orderBy: [
        { isFeatured: 'desc' },
        { startDate: 'desc' },
      ],
      select: {
        id: true,
        title: true,
        description: true,
        repoUrl: true,
        liveUrl: true,
        coverImage: true,
        techStack: true,
        category: true,
        status: true,
        startDate: true,
        endDate: true,
        isFeatured: true,
        highlights: true,
        metrics: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      success: true,
      count: projects.length,
      projects,
      metadata: {
        timestamp: new Date().toISOString(),
        filter: 'active',
      },
    };
  }
}
