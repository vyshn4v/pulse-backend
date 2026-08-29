import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PineconeService } from '../pinecone/pinecone.service';
import { CreateJobDto, UpdateJobDto } from './job.dto';

@Injectable()
export class JobService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pineconeService: PineconeService,
  ) {}

  async findAll(userId: number, status?: string) {
    const where: any = { userId };
    if (status && status !== 'all') {
      where.status = status;
    }

    return this.prisma.jobApplication.findMany({
      where,
      orderBy: { appliedAt: 'desc' },
      include: {
        hrDetails: true,
      },
    });
  }

  async findOne(userId: number, id: number) {
    const job = await this.prisma.jobApplication.findFirst({
      where: { id, userId },
      include: {
        hrDetails: true,
      },
    });

    if (!job) {
      throw new NotFoundException(`Job application #${id} not found`);
    }

    return job;
  }

  async create(userId: number, dto: CreateJobDto) {
    let hrDetailsId = dto.hrDetailsId ?? null;

    // Automatic HR Details upsert if hrEmail is provided
    if (dto.hrEmail && dto.hrEmail.trim()) {
      const email = dto.hrEmail.trim().toLowerCase();
      const hr = await this.prisma.hRDetails.upsert({
        where: { email },
        update: {
          name: dto.hrName?.trim() || undefined,
          phone: dto.hrPhone?.trim() || undefined,
          company: dto.company?.trim() || undefined,
        },
        create: {
          userId,
          name: dto.hrName?.trim() || '',
          email,
          phone: dto.hrPhone?.trim() || '',
          company: dto.company?.trim() || '',
        },
      });
      hrDetailsId = hr.id;
    }

    const created = await this.prisma.jobApplication.create({
      data: {
        userId,
        company: dto.company.trim(),
        role: dto.role.trim(),
        status: dto.status || 'applied',
        appliedAt: dto.appliedAt ? new Date(dto.appliedAt) : new Date(),
        source: dto.source || 'Other',
        jobLink: dto.jobLink?.trim() || '',
        salaryRange: dto.salaryRange?.trim() || '',
        notes: dto.notes?.trim() || '',
        hrDetailsId,
      },
      include: {
        hrDetails: true,
      },
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `job_${created.id}`,
        sourceType: 'job',
        sourceId: created.id,
        title: `[Job] ${created.company} - ${created.role}`,
        content: `${created.company} (${created.role}) - Status: ${created.status}. Source: ${created.source}. Notes: ${created.notes || 'None'}`,
        timestamp: created.appliedAt.toISOString(),
      })
      .catch(() => {});

    return created;
  }

  async update(userId: number, id: number, dto: UpdateJobDto) {
    await this.findOne(userId, id);

    let hrDetailsId = dto.hrDetailsId !== undefined ? dto.hrDetailsId : undefined;

    // Automatic HR Details upsert if hrEmail is provided
    if (dto.hrEmail && dto.hrEmail.trim()) {
      const email = dto.hrEmail.trim().toLowerCase();
      const hr = await this.prisma.hRDetails.upsert({
        where: { email },
        update: {
          name: dto.hrName?.trim() || undefined,
          phone: dto.hrPhone?.trim() || undefined,
          company: dto.company?.trim() || undefined,
        },
        create: {
          userId,
          name: dto.hrName?.trim() || '',
          email,
          phone: dto.hrPhone?.trim() || '',
          company: dto.company?.trim() || '',
        },
      });
      hrDetailsId = hr.id;
    }

    const data: any = {};
    if (dto.company !== undefined) data.company = dto.company.trim();
    if (dto.role !== undefined) data.role = dto.role.trim();
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.appliedAt !== undefined) data.appliedAt = new Date(dto.appliedAt);
    if (dto.source !== undefined) data.source = dto.source;
    if (dto.jobLink !== undefined) data.jobLink = dto.jobLink.trim();
    if (dto.salaryRange !== undefined) data.salaryRange = dto.salaryRange.trim();
    if (dto.notes !== undefined) data.notes = dto.notes.trim();
    if (hrDetailsId !== undefined) data.hrDetailsId = hrDetailsId;

    const updated = await this.prisma.jobApplication.update({
      where: { id },
      data,
      include: {
        hrDetails: true,
      },
    });

    // Incremental background vectorization to Pinecone (0ms latency impact)
    this.pineconeService
      .upsertMemory(userId, {
        id: `job_${updated.id}`,
        sourceType: 'job',
        sourceId: updated.id,
        title: `[Job] ${updated.company} - ${updated.role}`,
        content: `${updated.company} (${updated.role}) - Status: ${updated.status}. Source: ${updated.source}. Notes: ${updated.notes || 'None'}`,
        timestamp: updated.appliedAt.toISOString(),
      })
      .catch(() => {});

    return updated;
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    const deleted = await this.prisma.jobApplication.delete({
      where: { id },
    });

    // Incremental background vector deletion from Pinecone
    this.pineconeService.deleteMemory(userId, id, 'job').catch(() => {});

    return deleted;
  }
}
