import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { CreateActivityDto, UpdateActivityDto } from './activity.dto';

@Injectable()
export class ActivityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pineconeService: PineconeService,
  ) {}

  async findAll(userId: number, category?: string, status?: string) {
    const where: any = { userId };
    if (category && category !== 'all') {
      where.category = category;
    }
    if (status && status !== 'all') {
      where.status = status;
    }

    return this.prisma.activityLog.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });
  }

  async findOne(userId: number, id: number) {
    const activity = await this.prisma.activityLog.findFirst({
      where: { id, userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });

    if (!activity) {
      throw new NotFoundException(`Activity #${id} not found`);
    }

    return activity;
  }

  async create(userId: number, dto: CreateActivityDto) {
    const status = dto.status || 'pending';
    const noteContent = (dto.notes || dto.description || '').trim();

    if ((status === 'hold' || status === 'rejected') && !noteContent) {
      throw new BadRequestException(
        `A mandatory note or reason is required when status is set to '${status}'.`,
      );
    }

    const metadata = {
      ...(dto.metadata || {}),
      ...(dto.notes ? { notes: dto.notes } : {}),
      ...(status === 'hold' ? { holdReason: noteContent } : {}),
      ...(status === 'rejected' ? { rejectionReason: noteContent } : {}),
    };

    const start = dto.startDate ? new Date(dto.startDate) : dto.date ? new Date(dto.date) : new Date();
    const end = dto.endDate ? new Date(dto.endDate) : null;

    const created = await this.prisma.activityLog.create({
      data: {
        userId,
        title: dto.title || dto.description || 'Untitled Activity',
        description: dto.description || dto.title || '',
        category: dto.category || 'work',
        status,
        date: start,
        startDate: start,
        endDate: end,
        metadata,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `act_${created.id}`,
        sourceType: 'activity',
        sourceId: created.id,
        title: `[Activity] ${created.title || created.category}`,
        content: `${created.title}: ${created.description} (Category: ${created.category}, Status: ${created.status})`,
        timestamp: created.date.toISOString(),
      })
      .catch(() => {});

    return created;
  }

  async update(userId: number, id: number, dto: UpdateActivityDto) {
    const existing = await this.findOne(userId, id);

    const targetStatus = dto.status !== undefined ? dto.status : existing.status;
    const incomingNote = dto.notes !== undefined ? dto.notes.trim() : '';
    const existingMeta = (existing.metadata as Record<string, any>) || {};
    const existingNote = (existingMeta.notes || existing.description || '').trim();

    if (
      (targetStatus === 'hold' || targetStatus === 'rejected') &&
      !incomingNote &&
      !existingNote
    ) {
      throw new BadRequestException(
        `A mandatory note or reason is required when setting status to '${targetStatus}'.`,
      );
    }

    const data: any = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.category !== undefined) data.category = dto.category;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.date !== undefined) data.date = new Date(dto.date);
    if (dto.startDate !== undefined) {
      data.startDate = new Date(dto.startDate);
      data.date = new Date(dto.startDate);
    }
    if (dto.endDate !== undefined) {
      data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    }

    if (dto.metadata !== undefined || dto.notes !== undefined || dto.status !== undefined) {
      const activeReason = incomingNote || existingNote;
      data.metadata = {
        ...existingMeta,
        ...(dto.metadata || {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(targetStatus === 'hold' ? { holdReason: activeReason } : {}),
        ...(targetStatus === 'rejected' ? { rejectionReason: activeReason } : {}),
      };
    }

    const updated = await this.prisma.activityLog.update({
      where: { id },
      data,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            avatarUrl: true,
            role: true,
          },
        },
      },
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `act_${updated.id}`,
        sourceType: 'activity',
        sourceId: updated.id,
        title: `[Activity] ${updated.title || updated.category}`,
        content: `${updated.title}: ${updated.description} (Category: ${updated.category}, Status: ${updated.status})`,
        timestamp: updated.date.toISOString(),
      })
      .catch(() => {});

    return updated;
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    const deleted = await this.prisma.activityLog.delete({
      where: { id },
    });

    // Incremental background vector deletion from Pinecone
    this.pineconeService.deleteMemory(userId, id, 'activity').catch(() => {});

    return deleted;
  }
}
