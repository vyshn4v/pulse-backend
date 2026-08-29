import { Module } from '@nestjs/common';
import { HRController } from './hr.controller';
import { HRService } from './hr.service';

@Module({
  controllers: [HRController],
  providers: [HRService],
  exports: [HRService],
})
export class HRModule {}
