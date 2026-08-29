import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Req,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BrainService } from './brain.service';

@Controller('brain')
@UseGuards(JwtAuthGuard)
export class BrainController {
  constructor(private readonly brainService: BrainService) {}

  @Get('latest')
  async getLatest(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.brainService.getLatestSynthesis(userId);
  }

  @Get('history')
  async getHistory(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req.user.id);
    return this.brainService.getSynthesisHistory(userId, limit ? parseInt(limit, 10) : 15);
  }

  @Get('stats')
  async getStats(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.brainService.getStats(userId);
  }

  @Post('synthesize-now')
  async synthesizeNow(@Req() req: any, @Query('email') email?: string) {
    const userId = Number(req.user.id);
    const sendEmail = email === 'true';
    return this.brainService.generateDailySynthesis(userId, sendEmail);
  }

  @Post('index-memories')
  async indexMemories(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.brainService.bulkIndexMemories(userId);
  }

  @Get('memories')
  async getMemories(
    @Req() req: any,
    @Query('sourceType') sourceType?: string,
    @Query('search') search?: string,
  ) {
    const userId = Number(req.user.id);
    return this.brainService.getMemories(userId, sourceType, search);
  }
}
