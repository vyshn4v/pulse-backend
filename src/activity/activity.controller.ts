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
import { ActivityService } from './activity.service';
import { CreateActivityDto, UpdateActivityDto } from './activity.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('activity-log')
@UseGuards(JwtAuthGuard)
export class ActivityController {
  constructor(private readonly activityService: ActivityService) {}

  @Get()
  async findAll(
    @Req() req: any,
    @Query('category') category?: string,
    @Query('status') status?: string,
  ) {
    const userId = Number(req.user.id);
    return this.activityService.findAll(userId, category, status);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.activityService.findOne(userId, id);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateActivityDto) {
    const userId = Number(req.user.id);
    return this.activityService.create(userId, dto);
  }

  @Put(':id')
  async update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateActivityDto,
  ) {
    const userId = Number(req.user.id);
    return this.activityService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.activityService.remove(userId, id);
  }
}
