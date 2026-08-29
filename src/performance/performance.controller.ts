import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get('overview')
  @UseGuards(JwtAuthGuard)
  async getOverview(@Req() req: any, @Query('range') range?: string) {
    const userId = Number(req.user.id);
    return this.performanceService.getOverview(userId, range || '30d');
  }
}
