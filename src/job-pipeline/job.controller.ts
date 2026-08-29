import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JobService } from './job.service';
import { CreateJobDto, UpdateJobDto } from './job.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('job-pipeline')
@UseGuards(JwtAuthGuard)
export class JobController {
  constructor(private readonly jobService: JobService) {}

  @Get()
  async findAll(@Req() req: any, @Query('status') status?: string) {
    const userId = Number(req.user.id);
    return this.jobService.findAll(userId, status);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.jobService.findOne(userId, id);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateJobDto) {
    const userId = Number(req.user.id);
    return this.jobService.create(userId, dto);
  }

  @Put(':id')
  async update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateJobDto,
  ) {
    const userId = Number(req.user.id);
    return this.jobService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.jobService.remove(userId, id);
  }
}
