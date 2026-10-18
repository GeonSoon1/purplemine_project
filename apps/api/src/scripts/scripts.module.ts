import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisModule } from '../analysis/analysis.module';
import { ALL_ENTITIES } from '../entities';
import { FilesModule } from '../files/files.module';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';

@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES), FilesModule, AnalysisModule],
  controllers: [ScriptsController],
  providers: [ScriptsService],
})
export class ScriptsModule {}
