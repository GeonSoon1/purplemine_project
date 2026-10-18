import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'node:path';
import { AnalysisModule } from './analysis/analysis.module';
import { appConfig, AppConfig } from './config/app.config';
import { ALL_ENTITIES } from './entities';
import { QuotesModule } from './quotes/quotes.module';
import { ScriptsModule } from './scripts/scripts.module';
import { VehiclesModule } from './vehicles/vehicles.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        type: 'postgres' as const,
        url: config.get('databaseUrl', { infer: true }),
        entities: ALL_ENTITIES,
        migrations: [join(__dirname, 'database/migrations/*{.ts,.js}')],
        migrationsRun: config.get('migrationsRun', { infer: true }),
        synchronize: false, // 스키마 변경은 마이그레이션으로만
        uuidExtension: 'pgcrypto' as const,
      }),
    }),
    ScriptsModule,
    AnalysisModule,
    VehiclesModule,
    QuotesModule,
  ],
})
export class AppModule {}
