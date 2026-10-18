import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { appConfig } from '../config/app.config';
import { LlmClient } from '../llm/llm.client';
import { BACKFILL_BATCH_SIZE, VehicleEmbeddingService } from '../vehicles/vehicle-embedding.service';
import dataSource from './data-source';

/** npm run embed:backfill — embedding 이 null 이거나 embedding_model 이 현재 모델과 다른 차량을 배치로 임베딩. 재실행해도 안전. */
export async function runEmbedBackfill(batchSize = BACKFILL_BATCH_SIZE) {
  const llm = new LlmClient(new ConfigService(appConfig()) as never);
  const svc = new VehicleEmbeddingService(dataSource, llm);
  const res = await svc.backfill(batchSize, (r) => console.log(`  ... ${r.updated + r.failed}/${r.targets} 처리`));
  console.log(`embed:backfill: 모델 ${res.model}, 대상 ${res.targets}대, 성공 ${res.updated}, 실패 ${res.failed}`);
  return res;
}

if (require.main === module) {
  (async () => {
    await dataSource.initialize();
    try {
      const res = await runEmbedBackfill();
      process.exitCode = res.failed ? 1 : 0;
    } finally {
      await dataSource.destroy();
    }
  })().catch((e) => {
    console.error(`embed:backfill 실패: ${(e as Error).message}`);
    process.exit(1);
  });
}
