import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vehicle } from '../entities';
import { LlmModule } from '../llm/llm.module';
import { CandidateMatcher } from './candidate-matcher.service';

@Module({
  imports: [TypeOrmModule.forFeature([Vehicle]), LlmModule],
  providers: [CandidateMatcher],
  exports: [CandidateMatcher],
})
export class MatchingModule {}
