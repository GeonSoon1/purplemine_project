import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '../entities';
import { LlmModule } from '../llm/llm.module';
import { VehicleEmbeddingService } from './vehicle-embedding.service';
import { VehiclesController } from './vehicles.controller';
import { VehiclesService } from './vehicles.service';

@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES), LlmModule],
  controllers: [VehiclesController],
  providers: [VehiclesService, VehicleEmbeddingService],
})
export class VehiclesModule {}
