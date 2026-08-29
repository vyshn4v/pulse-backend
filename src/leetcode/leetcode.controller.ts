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
import { LeetCodeService } from './leetcode.service';
import {
  UpdateLeetCodeConfigDto,
  CreateManualSubmissionDto,
  UpdateSubmissionNotesDto,
} from './leetcode.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('leetcode')
@UseGuards(JwtAuthGuard)
export class LeetCodeController {
  constructor(private readonly leetcodeService: LeetCodeService) {}

  @Get('config')
  async getConfig(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.leetcodeService.getConfig(userId);
  }

  @Put('config')
  async updateConfig(@Req() req: any, @Body() dto: UpdateLeetCodeConfigDto) {
    const userId = Number(req.user.id);
    return this.leetcodeService.updateConfig(userId, dto);
  }

  @Get('stats')
  async getStats(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.leetcodeService.getStats(userId);
  }

  @Get('submissions')
  async getSubmissions(
    @Req() req: any,
    @Query('difficulty') difficulty?: string,
    @Query('search') search?: string,
  ) {
    const userId = Number(req.user.id);
    return this.leetcodeService.findAllSubmissions(userId, difficulty, search);
  }

  @Post('sync')
  async sync(@Req() req: any, @Body() body?: { username?: string }) {
    const userId = Number(req.user.id);
    return this.leetcodeService.scrapeLeetCodeProfile(userId, body?.username);
  }

  @Post('scrape')
  async scrape(@Req() req: any, @Body() body?: { username?: string }) {
    const userId = Number(req.user.id);
    return this.leetcodeService.scrapeLeetCodeProfile(userId, body?.username);
  }

  @Post('manual')
  async createManual(@Req() req: any, @Body() dto: CreateManualSubmissionDto) {
    const userId = Number(req.user.id);
    return this.leetcodeService.createManualSubmission(userId, dto);
  }

  @Put(':id/notes')
  async updateNotes(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSubmissionNotesDto,
  ) {
    const userId = Number(req.user.id);
    return this.leetcodeService.updateNotes(userId, id, dto.notes);
  }

  @Delete(':id')
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.leetcodeService.removeSubmission(userId, id);
  }
}
