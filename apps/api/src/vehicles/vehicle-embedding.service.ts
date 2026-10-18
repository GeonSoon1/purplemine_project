import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { LlmClient } from '../llm/llm.client';

export const BACKFILL_BATCH_SIZE = 16;

/** pgvector 리터럴 "[0.1,0.2,...]". */
export const toVectorLiteral = (v: number[]): string => `[${v.join(',')}]`;

/** 임베딩 대상 텍스트: description (비어 있으면 브랜드+모델). */
export const embeddingText = (v: { description?: string | null; brand: string; model: string }): string =>
  (v.description?.trim() || `${v.brand} ${v.model}`.trim()).slice(0, EMBED_TEXT_MAX); // LLM 서버 texts[] 최대 4000자

const EMBED_TEXT_MAX = 4000;

export interface BackfillResult {
  model: string;
  targets: number;
  updated: number;
  failed: number;
}

/**
 * vehicles.embedding / embedding_model 쓰기 전담 (DB 쓰기는 NestJS 만, LLM 서버는 읽기 전용).
 * embedding 컬럼은 엔티티에 매핑하지 않고 raw SQL 로만 다룬다.
 */
@Injectable()
export class VehicleEmbeddingService {
  private readonly logger = new Logger(VehicleEmbeddingService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly llm: LlmClient,
  ) {}

  /** 단건 임베딩 저장. 실패해도 예외를 던지지 않는다(차량 등록/수정은 성공해야 함). 성공 여부 반환. */
  async embedVehicle(vehicle: { id: string; description?: string | null; brand: string; model: string }): Promise<boolean> {
    try {
      const res = await this.llm.embed([embeddingText(vehicle)], 'passage');
      await this.save(vehicle.id, res.embeddings[0], res.model);
      return true;
    } catch (e) {
      this.logger.warn(`차량 ${vehicle.id} 임베딩 실패(embedding 은 null 유지, 나중에 npm run embed:backfill): ${(e as Error).message}`);
      return false;
    }
  }

  /** 낡은 임베딩 제거 (설명이 바뀌었는데 재임베딩이 실패했을 때 오래된 벡터가 남지 않도록). */
  async clear(id: string): Promise<void> {
    await this.dataSource.query(`UPDATE vehicles SET embedding = NULL, embedding_model = NULL WHERE id = $1`, [id]);
  }

  private async save(id: string, embedding: number[], model: string): Promise<void> {
    await this.dataSource.query(`UPDATE vehicles SET embedding = $1::vector, embedding_model = $2 WHERE id = $3`, [
      toVectorLiteral(embedding),
      model,
      id,
    ]);
  }

  /** 현재 임베딩 모델명: 짧은 텍스트를 한 번 임베딩해 응답의 model 을 읽는다. */
  async currentModel(): Promise<string> {
    return (await this.llm.embed(['model probe'], 'passage')).model;
  }

  /** 재임베딩 대상: embedding 이 null 이거나 embedding_model 이 현재 모델과 다름. id 키셋 페이지네이션. */
  async selectTargets(model: string, afterId: string | null, limit: number) {
    return this.dataSource.query(
      `SELECT id, brand, model, description FROM vehicles
        WHERE (embedding IS NULL OR embedding_model IS DISTINCT FROM $1)
          AND ($2::uuid IS NULL OR id > $2::uuid)
        ORDER BY id LIMIT $3`,
      [model, afterId, limit],
    ) as Promise<Array<{ id: string; brand: string; model: string; description: string }>>;
  }

  /** 배치로 임베딩을 채운다. 배치가 실패하면 그 배치는 건너뛰고(failed 집계) 계속한다. */
  async backfill(batchSize = BACKFILL_BATCH_SIZE, onBatch?: (r: BackfillResult) => void): Promise<BackfillResult> {
    const model = await this.currentModel();
    const result: BackfillResult = { model, targets: 0, updated: 0, failed: 0 };
    let after: string | null = null;
    for (;;) {
      const batch = await this.selectTargets(model, after, batchSize);
      if (!batch.length) break;
      after = batch[batch.length - 1].id;
      result.targets += batch.length;
      try {
        const res = await this.llm.embed(batch.map(embeddingText), 'passage');
        for (let i = 0; i < batch.length; i++) await this.save(batch[i].id, res.embeddings[i], res.model);
        result.updated += batch.length;
      } catch (e) {
        result.failed += batch.length;
        this.logger.warn(`배치 임베딩 실패(${batch.length}대): ${(e as Error).message}`);
      }
      onBatch?.(result);
    }
    return result;
  }
}
