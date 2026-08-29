import {
  Controller,
  Get,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SystemMonitorService } from './system-monitor.service';

@Controller('system-monitor')
export class SystemMonitorController {
  constructor(private readonly systemMonitorService: SystemMonitorService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'PULSE v3 System Telemetry Monitor',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('stats')
  @UseGuards(JwtAuthGuard)
  async getStats() {
    return this.systemMonitorService.getSystemSnapshot();
  }

  @Get('stream')
  @UseGuards(JwtAuthGuard)
  async streamMetrics(@Req() req: any, @Res() res: any) {
    return this.systemMonitorService.handleSseStream(res, req);
  }
}
