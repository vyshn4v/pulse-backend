import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { MediumService } from './medium.service';
import { PublicPostsQueryDto } from './medium.dto';
import { PublicApiSecurityGuard } from './guards/public-api-security.guard';

@Controller('public/medium-posts')
@UseGuards(PublicApiSecurityGuard)
export class MediumPublicController {
  constructor(private readonly mediumService: MediumService) {}

  /**
   * Open / Public Portfolio API
   * Fetch all non-hidden Medium posts formatted for personal websites/portfolios.
   * Example: GET /api/public/medium-posts?limit=10&sort=latest
   */
  @Get()
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

  /**
   * Fetch a single public post by ID
   * Example: GET /api/public/medium-posts/1
   */
  @Get(':id')
  async getPublicOne(@Param('id', ParseIntPipe) id: number) {
    return this.mediumService.findPublicOne(id);
  }
}
