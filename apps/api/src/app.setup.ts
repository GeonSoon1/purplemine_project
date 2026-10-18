import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

/** main.ts 와 e2e 테스트가 공유하는 앱 공통 설정. */
export function setupApp(app: INestApplication, corsOrigin: string[]): void {
  app.setGlobalPrefix('api');
  app.enableCors({ origin: corsOrigin });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
}
