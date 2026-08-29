import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsPublicController } from './projects-public.controller';
import { ProjectsService } from './projects.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PineconeModule } from '../pinecone/pinecone.module';

@Module({
  imports: [PrismaModule, PineconeModule],
  controllers: [ProjectsController, ProjectsPublicController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
