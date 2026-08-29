import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { HRService } from './hr.service';
import { CreateHRDto, UpdateHRDto } from './hr.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('hr-details')
@UseGuards(JwtAuthGuard)
export class HRController {
  constructor(private readonly hrService: HRService) {}

  @Get()
  async findAll(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.hrService.findAll(userId);
  }

  @Get(':id')
  async findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.hrService.findOne(userId, id);
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateHRDto) {
    const userId = Number(req.user.id);
    return this.hrService.create(userId, dto);
  }

  @Put(':id')
  async update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHRDto,
  ) {
    const userId = Number(req.user.id);
    return this.hrService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.hrService.remove(userId, id);
  }
}
