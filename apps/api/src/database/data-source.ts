import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '../entities';

loadEnv({ quiet: true });

/** TypeORM CLI(migration:run) 와 seed 스크립트용. 앱은 AppModule 의 TypeOrmModule 설정 사용. */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://purplemine:purplemine@localhost:5433/purplemine',
  entities: ALL_ENTITIES,
  migrations: [join(__dirname, 'migrations/*{.ts,.js}')],
  synchronize: false,
});
