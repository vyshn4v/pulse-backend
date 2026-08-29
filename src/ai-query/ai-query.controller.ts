import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiQueryService } from './ai-query.service';
import { AskAiQueryDto } from './ai-query.dto';

@Controller('ai-query')
@UseGuards(JwtAuthGuard)
export class AiQueryController {
  constructor(private readonly aiQueryService: AiQueryService) {}

  @Post()
  async askRoot(@Req() req: any, @Body() dto: AskAiQueryDto) {
    const userId = Number(req.user.id);
    return this.aiQueryService.askQuery(userId, dto);
  }

  @Post('ask')
  async ask(@Req() req: any, @Body() dto: AskAiQueryDto) {
    const userId = Number(req.user.id);
    return this.aiQueryService.askQuery(userId, dto);
  }

  @Post('stream')
  async stream(@Req() req: any, @Res() res: any, @Body() dto: AskAiQueryDto) {
    const userId = Number(req.user.id);
    return this.aiQueryService.streamQuery(userId, dto, res, req);
  }

  @Get('history')
  async getHistory(@Req() req: any, @Query('limit') limit?: string) {
    const userId = Number(req.user.id);
    return this.aiQueryService.getHistory(userId, limit ? parseInt(limit, 10) : 30);
  }

  @Delete('history/:id')
  async deleteItem(@Req() req: any, @Param('id', ParseIntPipe) id: number) {
    const userId = Number(req.user.id);
    return this.aiQueryService.deleteHistoryItem(userId, id);
  }

  @Delete('history')
  async clearHistory(@Req() req: any) {
    const userId = Number(req.user.id);
    return this.aiQueryService.clearHistory(userId);
  }
}
