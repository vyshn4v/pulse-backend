import {
  Controller,
  Get,
  Put,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MeService } from './me.service';
import { UpdateMeDto } from './me.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  async getProfile(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.meService.getProfile(userId);
  }

  @Put()
  async updateProfile(@Req() req: any, @Body() dto: UpdateMeDto) {
    const userId = Number(req.user.id);
    return this.meService.updateProfile(userId, dto);
  }
}
