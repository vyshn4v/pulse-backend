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
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { LinkedInService } from './linkedin.service';
import { CreateLinkedInPostDto, UpdateLinkedInPostDto } from './linkedin.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

type HttpReply = {
  code?: (statusCode: number) => HttpReply;
  header?: (name: string, value: string) => HttpReply;
  redirect: (url: string, code?: number) => unknown;
  send?: (body: unknown) => unknown;
};

@Controller('linkedin')
export class LinkedInController {
  constructor(private readonly linkedinService: LinkedInService) {}

  // ---------------------------------------------------------------------------
  // OAuth 2.0 & Account Management
  // ---------------------------------------------------------------------------

  @Get('auth-url')
  @UseGuards(JwtAuthGuard)
  getAuthUrl(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.linkedinService.getAuthUrl(userId);
  }

  @Get('callback')
  async handleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: HttpReply,
  ) {
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    try {
      if (!code) {
        return res.redirect(`${frontendUrl}/linkedin?linkedin_auth=failed&msg=No+code+received`, 302);
      }
      await this.linkedinService.handleOAuthCallback(code, state);
      return res.redirect(`${frontendUrl}/linkedin?linkedin_auth=success`, 302);
    } catch (err: any) {
      console.error('[LinkedIn OAuth] Callback failed:', err?.message || err);
      return res.redirect(
        `${frontendUrl}/linkedin?linkedin_auth=failed&msg=${encodeURIComponent(err.message || 'OAuth failed')}`,
        302,
      );
    }
  }

  @Get('account-status')
  @UseGuards(JwtAuthGuard)
  async getAccountStatus(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.linkedinService.getAccountStatus(userId);
  }

  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  async disconnect(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.linkedinService.disconnectAccount(userId);
  }

  // ---------------------------------------------------------------------------
  // Publishing Actions
  // ---------------------------------------------------------------------------

  @Post('posts/:id/publish-now')
  @UseGuards(JwtAuthGuard)
  async publishNow(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.linkedinService.publishPostToLinkedIn(userId, id);
  }

  @Post('posts/:id/comment-now')
  @UseGuards(JwtAuthGuard)
  async commentNow(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.linkedinService.publishCommentToLinkedIn(userId, id);
  }

  @Post('trigger-cron')
  @UseGuards(JwtAuthGuard)
  async triggerCron() {
    return this.linkedinService.triggerManualPublisherRun();
  }

  // ---------------------------------------------------------------------------
  // Post Management & Stats
  // ---------------------------------------------------------------------------

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.linkedinService.getStats(userId);
  }

  @Get('posts')
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
  ) {
    const userId = Number(req.user.id);
    return this.linkedinService.findAll(userId, status, tag, search);
  }

  @Get('posts/:id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.linkedinService.findOne(userId, id);
  }

  @Post('posts')
  @UseGuards(JwtAuthGuard)
  async create(@Req() req: any, @Body() dto: CreateLinkedInPostDto) {
    const userId = Number(req.user.id);
    return this.linkedinService.create(userId, dto);
  }

  @Put('posts/:id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateLinkedInPostDto,
  ) {
    const userId = Number(req.user.id);
    return this.linkedinService.update(userId, id, dto);
  }

  @Delete('posts/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.linkedinService.remove(userId, id);
  }
}
