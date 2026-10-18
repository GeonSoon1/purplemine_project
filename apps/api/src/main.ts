import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import type { AppConfig } from './config/app.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get<ConfigService<AppConfig, true>>(ConfigService);
  setupApp(app, config.get('corsOrigin', { infer: true }));
  app.enableShutdownHooks();
  await app.listen(config.get('port', { infer: true }));
}
void bootstrap();
