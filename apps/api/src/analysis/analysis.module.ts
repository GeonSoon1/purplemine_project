import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '../entities';
import { FilesModule } from '../files/files.module';
import { LlmModule } from '../llm/llm.module';
import { MatchingModule } from '../matching/matching.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisRunner } from './analysis-runner.service';
import { AnalysisService } from './analysis.service';
import { RequirementsService } from './requirements.service';

@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES), FilesModule, LlmModule, MatchingModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, RequirementsService, AnalysisRunner],
  exports: [AnalysisRunner],
})
export class AnalysisModule {}
