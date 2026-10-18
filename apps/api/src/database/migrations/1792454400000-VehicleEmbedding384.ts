import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 로컬 임베딩(multilingual-e5-small, 384차원)으로 전환.
 * - vehicles.embedding vector(1536) -> vector(384). 차원이 다른 기존 값은 변환할 수 없으므로
 *   NULL 로 비운다 (이전 단계에서 임베딩을 생성한 적이 없어 모두 NULL). 이후 npm run embed:backfill 로 채운다.
 * - vehicles.embedding_model: 어떤 모델로 만든 벡터인지 기록 (모델 교체 시 재임베딩 대상 판별).
 * - HNSW 인덱스는 컬럼 타입 변경 전에 drop, 변경 후 재생성.
 */
export class VehicleEmbedding3841792454400000 implements MigrationInterface {
  name = 'VehicleEmbedding3841792454400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_vehicles_embedding_hnsw`);
    await q.query(`UPDATE vehicles SET embedding = NULL WHERE embedding IS NOT NULL`);
    await q.query(`ALTER TABLE vehicles ALTER COLUMN embedding TYPE vector(384) USING NULL::vector(384)`);
    await q.query(`ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS embedding_model varchar(100)`);
    await q.query(`CREATE INDEX idx_vehicles_embedding_hnsw ON vehicles USING hnsw (embedding vector_cosine_ops)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_vehicles_embedding_hnsw`);
    await q.query(`ALTER TABLE vehicles DROP COLUMN IF EXISTS embedding_model`);
    await q.query(`UPDATE vehicles SET embedding = NULL WHERE embedding IS NOT NULL`); // 384 -> 1536 변환 불가
    await q.query(`ALTER TABLE vehicles ALTER COLUMN embedding TYPE vector(1536) USING NULL::vector(1536)`);
    await q.query(`CREATE INDEX idx_vehicles_embedding_hnsw ON vehicles USING hnsw (embedding vector_cosine_ops)`);
  }
}
