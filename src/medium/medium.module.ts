import { Module } from '@nestjs/common';
import { MediumController } from './medium.controller';
import { MediumPublicController } from './medium-public.controller';
import { MediumService } from './medium.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PineconeModule } from '../pinecone/pinecone.module';

@Module({
  imports: [PrismaModule, PineconeModule],
  controllers: [MediumController, MediumPublicController],
  providers: [MediumService],
  exports: [MediumService],
})
export class MediumModule {}
