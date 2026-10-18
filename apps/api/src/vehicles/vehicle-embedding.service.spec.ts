import { LlmClientError } from '../llm/llm.client';
import { embeddingText, toVectorLiteral, VehicleEmbeddingService } from './vehicle-embedding.service';

const vec = (n: number) => Array.from({ length: 384 }, () => n);

describe('VehicleEmbeddingService', () => {
  it('embeddingText: description, 비면 브랜드+모델', () => {
    expect(embeddingText({ description: ' 설명 ', brand: 'a', model: 'b' })).toBe('설명');
    expect(embeddingText({ description: '', brand: '기아', model: '모닝' })).toBe('기아 모닝');
    expect(toVectorLiteral([1, 2.5])).toBe('[1,2.5]');
  });

  it('embedVehicle: 성공하면 embedding/embedding_model 저장', async () => {
    const ds = { query: jest.fn().mockResolvedValue([]) };
    const llm = { embed: jest.fn().mockResolvedValue({ model: 'e5', dimension: 384, embeddings: [vec(1)] }) };
    const svc = new VehicleEmbeddingService(ds as never, llm as never);
    await expect(svc.embedVehicle({ id: 'v', description: 'd', brand: 'b', model: 'm' })).resolves.toBe(true);
    expect(llm.embed).toHaveBeenCalledWith(['d'], 'passage');
    expect(ds.query.mock.calls[0][1][1]).toBe('e5');
    expect(ds.query.mock.calls[0][1][2]).toBe('v');
  });

  it('embedVehicle: LLM 실패는 던지지 않고 false (DB 쓰기 없음)', async () => {
    const ds = { query: jest.fn() };
    const llm = { embed: jest.fn().mockRejectedValue(new LlmClientError('down')) };
    const svc = new VehicleEmbeddingService(ds as never, llm as never);
    await expect(svc.embedVehicle({ id: 'v', description: 'd', brand: 'b', model: 'm' })).resolves.toBe(false);
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('backfill: 현재 모델 기준으로 대상을 배치로 선택해 저장, 실패 배치는 건너뛴다', async () => {
    const rows = ['a', 'b', 'c'].map((id) => ({ id, brand: 'x', model: 'y', description: id }));
    const ds = {
      query: jest.fn(async (sql: string, params: unknown[]) => {
        if (sql.startsWith('SELECT')) {
          const [model, after, limit] = params as [string, string | null, number];
          expect(model).toBe('e5');
          return rows.filter((r) => !after || r.id > after).slice(0, limit);
        }
        return [];
      }),
    };
    const llm = {
      embed: jest
        .fn()
        .mockResolvedValueOnce({ model: 'e5', dimension: 384, embeddings: [vec(0)] }) // probe
        .mockResolvedValueOnce({ model: 'e5', dimension: 384, embeddings: [vec(1), vec(1)] }) // [a,b]
        .mockRejectedValueOnce(new LlmClientError('boom')), // [c]
    };
    const svc = new VehicleEmbeddingService(ds as never, llm as never);
    const res = await svc.backfill(2);
    expect(res).toEqual({ model: 'e5', targets: 3, updated: 2, failed: 1 });
    expect(llm.embed.mock.calls[1][0]).toEqual(['a', 'b']);
    const sql = ds.query.mock.calls.find((c) => (c[0] as string).startsWith('SELECT'))![0] as string;
    expect(sql).toMatch(/embedding IS NULL OR embedding_model IS DISTINCT FROM/);
  });
});
