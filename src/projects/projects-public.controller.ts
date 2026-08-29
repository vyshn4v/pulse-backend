import {
  Controller,
  Get,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PublicProjectsQueryDto } from './projects.dto';
import { PublicApiSecurityGuard } from '../medium/guards/public-api-security.guard';

@Controller('public/projects')
@UseGuards(PublicApiSecurityGuard)
export class ProjectsPublicController {
  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Open / Public Portfolio API
   * Fetch all non-hidden projects formatted for personal websites/portfolios.
   * Example: GET /api/public/projects?limit=10&sort=latest&category=personal
   */
  @Get()
  async getPublicProjects(
    @Query('category') category?: string,
    @Query('techStack') techStack?: string,
    @Query('limit') limit?: number,
    @Query('sort') sort?: 'latest' | 'popular',
    @Query('featured') featured?: string,
    @Query('status') status?: string,
  ) {
    const query: PublicProjectsQueryDto = {
      category,
      techStack,
      limit: limit ? Number(limit) : undefined,
      sort,
      featured: featured === 'true' ? true : featured === 'false' ? false : undefined,
      status,
    };
    return this.projectsService.findPublicProjects(query);
  }

  /**
   * Fetch only active, visible projects
   * Example: GET /api/public/projects/active
   */
  @Get('active')
  async getActiveProjects() {
    return this.projectsService.getActiveProjects();
  }

  /**
   * Fetch a single public project by ID
   * Example: GET /api/public/projects/1
   */
  @Get(':id')
  async getPublicOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findPublicOne(id);
  }
}
