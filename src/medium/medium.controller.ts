import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { MediumService } from './medium.service';
import {
  CreateMediumPostDto,
  UpdateMediumPostDto,
  FetchMediumMetadataDto,
  PublicPostsQueryDto,
} from './medium.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('medium-posts')
export class MediumController {
  constructor(private readonly mediumService: MediumService) {}

  // ---------------------------------------------------------------------------
  // Public Open Endpoint (Available without auth for external portfolios)
  // ---------------------------------------------------------------------------

  @Get('public')
  async getPublicPosts(
    @Query('tag') tag?: string,
    @Query('limit') limit?: number,
    @Query('sort') sort?: 'latest' | 'popular',
    @Query('featured') featured?: string,
    @Query('status') status?: string,
  ) {
    const query: PublicPostsQueryDto = {
      tag,
      limit: limit ? Number(limit) : undefined,
      sort,
      featured: featured === 'true' ? true : featured === 'false' ? false : undefined,
      status,
    };
    return this.mediumService.findPublicPosts(query);
  }

  @Get('public/:id')
  async getPublicOne(@Param('id', ParseIntPipe) id: number) {
    return this.mediumService.findPublicOne(id);
  }

  // ---------------------------------------------------------------------------
  // Authenticated Admin Endpoints (Requires JWT Auth)
  // ---------------------------------------------------------------------------

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.mediumService.getStats(userId);
  }

  @Put('username')
  @UseGuards(JwtAuthGuard)
  async updateUsername(@Req() req: any, @Body() body: { username: string }) {
    const userId = Number(req.user.id);
    return this.mediumService.updateMediumUsername(userId, body.username);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('tag') tag?: string,
    @Query('search') search?: string,
  ) {
    const userId = Number(req.user.id);
    return this.mediumService.findAll(userId, { status, tag, search });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.mediumService.findOne(userId, id);
  }

  @Post('fetch-metadata')
  @UseGuards(JwtAuthGuard)
  async fetchMetadata(@Body() dto: FetchMediumMetadataDto) {
    return this.mediumService.fetchMetadataFromUrl(dto.url);
  }

  @Get('feed')
  @UseGuards(JwtAuthGuard)
  async fetchFeed(@Query('handle') handle: string) {
    return this.mediumService.fetchAuthorFeed(handle);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Req() req: any, @Body() dto: CreateMediumPostDto) {
    const userId = Number(req.user.id);
    return this.mediumService.create(userId, dto);
  }

  @Post('batch')
  @UseGuards(JwtAuthGuard)
  async batchCreate(@Req() req: any, @Body() body: { articles: CreateMediumPostDto[] }) {
    const userId = Number(req.user.id);
    return this.mediumService.batchCreate(userId, body.articles);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMediumPostDto,
  ) {
    const userId = Number(req.user.id);
    return this.mediumService.update(userId, id, dto);
  }

  @Patch(':id/toggle-visibility')
  @UseGuards(JwtAuthGuard)
  async toggleVisibility(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.mediumService.toggleVisibility(userId, id);
  }

  @Patch(':id/toggle-featured')
  @UseGuards(JwtAuthGuard)
  async toggleFeatured(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.mediumService.toggleFeatured(userId, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.mediumService.remove(userId, id);
  }
}
