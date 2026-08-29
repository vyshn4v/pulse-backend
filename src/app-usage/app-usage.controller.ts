import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AppUsageService } from './app-usage.service';
import { LogAppUsageDto, BatchLogAppUsageDto, AppUsageQueryDto } from './dto/app-usage.dto';

@Controller('app-usage')
@UseGuards(JwtAuthGuard)
export class AppUsageController {
  constructor(private readonly appUsageService: AppUsageService) {}

  @Post('log')
  async logUsage(@Req() req: any, @Body() dto: LogAppUsageDto) {
    const userId = Number(req.user.id);
    return this.appUsageService.logUsage(userId, dto);
  }

  @Post('batch')
  async batchLog(@Req() req: any, @Body() dto: BatchLogAppUsageDto) {
    const userId = Number(req.user.id);
    return this.appUsageService.batchLogUsage(userId, dto);
  }

  @Get('today')
  async getToday(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.appUsageService.getTodaySummary(userId);
  }

  @Get('analytics')
  async getAnalytics(@Req() req: any, @Query() query: AppUsageQueryDto) {
    const userId = Number(req.user.id);
    return this.appUsageService.getHistoricalAnalytics(userId, query);
  }

  @Get('logs')
  async getRecentLogs(
    @Req() req: any,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('device') device?: string,
  ) {
    const userId = Number(req.user.id);
    return this.appUsageService.getRecentLogs(userId, {
      limit: limit ? parseInt(limit, 10) : 60,
      search,
      category,
      device,
    });
  }

  @Post('digest')
  async triggerDigest(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.appUsageService.sendDailyDigestEmail(userId);
  }

  @Delete('logs/:id')
  async deleteLog(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.appUsageService.deleteLog(userId, id);
  }
}
