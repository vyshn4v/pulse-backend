import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHRDto, UpdateHRDto } from './hr.dto';

@Injectable()
export class HRService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(userId: number) {
    return this.prisma.hRDetails.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        jobApplications: {
          select: {
            id: true,
            company: true,
            role: true,
            status: true,
            appliedAt: true,
          },
        },
      },
    });
  }

  async findOne(userId: number, id: number) {
    const hr = await this.prisma.hRDetails.findFirst({
      where: { id, userId },
      include: {
        jobApplications: {
          select: {
            id: true,
            company: true,
            role: true,
            status: true,
            appliedAt: true,
          },
        },
      },
    });

    if (!hr) {
      throw new NotFoundException(`HR contact #${id} not found`);
    }

    return hr;
  }

  async create(userId: number, dto: CreateHRDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.hRDetails.findUnique({
      where: { email },
    });

    if (existing) {
      throw new ConflictException(`HR contact with email '${email}' already exists.`);
    }

    return this.prisma.hRDetails.create({
      data: {
        userId,
        name: dto.name?.trim() || '',
        email,
        phone: dto.phone?.trim() || '',
        company: dto.company?.trim() || '',
        notes: dto.notes?.trim() || '',
      },
    });
  }

  async update(userId: number, id: number, dto: UpdateHRDto) {
    await this.findOne(userId, id);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (dto.phone !== undefined) data.phone = dto.phone.trim();
    if (dto.company !== undefined) data.company = dto.company.trim();
    if (dto.notes !== undefined) data.notes = dto.notes.trim();

    return this.prisma.hRDetails.update({
      where: { id },
      data,
      include: {
        jobApplications: {
          select: {
            id: true,
            company: true,
            role: true,
            status: true,
            appliedAt: true,
          },
        },
      },
    });
  }

  async remove(userId: number, id: number) {
    await this.findOne(userId, id);
    return this.prisma.hRDetails.delete({
      where: { id },
    });
  }
}
