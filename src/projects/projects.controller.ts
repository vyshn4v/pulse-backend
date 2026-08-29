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
import { ProjectsService } from './projects.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  PublicProjectsQueryDto,
} from './projects.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  // ---------------------------------------------------------------------------
  // Public Open Endpoint (Available without auth for external portfolios)
  // ---------------------------------------------------------------------------

  @Get('public')
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

  @Get('public/:id')
  async getPublicOne(@Param('id', ParseIntPipe) id: number) {
    return this.projectsService.findPublicOne(id);
  }

  // ---------------------------------------------------------------------------
  // Authenticated Admin Endpoints (Requires JWT Auth)
  // ---------------------------------------------------------------------------

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.projectsService.getStats(userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(
    @Req() req: any,
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('techStack') techStack?: string,
    @Query('search') search?: string,
  ) {
    const userId = Number(req.user.id);
    return this.projectsService.findAll(userId, { status, category, techStack, search });
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.projectsService.findOne(userId, id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Req() req: any, @Body() dto: CreateProjectDto) {
    const userId = Number(req.user.id);
    return this.projectsService.create(userId, dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Req() req: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateProjectDto,
  ) {
    const userId = Number(req.user.id);
    return this.projectsService.update(userId, id, dto);
  }

  @Patch(':id/toggle-visibility')
  @UseGuards(JwtAuthGuard)
  async toggleVisibility(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.projectsService.toggleVisibility(userId, id);
  }

  @Patch(':id/toggle-featured')
  @UseGuards(JwtAuthGuard)
  async toggleFeatured(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.projectsService.toggleFeatured(userId, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.projectsService.remove(userId, id);
  }
}
