import { VehicleCategory } from '../common/enums';
import { LlmClientError } from '../llm/llm.client';
import { CandidateMatcher } from './candidate-matcher.service';

const sedan = { id: '11111111-1111-4111-8111-111111111111', brand: '현대', model: '쏘나타', category: VehicleCategory.SEDAN, color: '흰색', damageAllowed: true, dailyRate: 90000, description: '' };
const g90 = { id: '22222222-2222-4222-8222-222222222222', brand: '제네시스', model: 'G90', category: VehicleCategory.SEDAN, color: '검정', damageAllowed: true, dailyRate: 220000, description: '' };
const req = { vehicleType: '세단', categoryHint: VehicleCategory.SEDAN, brandModelHint: null, usage: 'NORMAL' as const, damageExpected: false, sourceQuote: null, quantity: 2 };

function setup(opts: { mode?: 'rag' | 'rule'; match?: jest.Mock; live?: string[] } = {}) {
  const repo = {
    findBy: jest.fn().mockResolvedValue([sedan, g90]),
    find: jest.fn().mockResolvedValue((opts.live ?? [sedan.id, g90.id]).map((id) => ({ id }))),
  };
  const llm = { match: opts.match ?? jest.fn() };
  const config = { get: jest.fn(() => opts.mode ?? 'rag') };
  return { m: new CandidateMatcher(repo as never, llm as never, config as never), repo, llm };
}

describe('CandidateMatcher', () => {
  it('rag: /match 결과를 점수 내림차순으로 rank 부여, quantity 전달', async () => {
    const match = jest.fn().mockResolvedValue({
      model: 'm',
      candidates: [{ vehicleId: sedan.id, score: 60, reason: 'a' }, { vehicleId: g90.id, score: 90, reason: 'b' }],
    });
    const { m, repo } = setup({ match });
    const out = await m.match(req);
    expect(out.source).toBe('rag');
    expect(out.results).toEqual([
      { vehicleId: g90.id, score: 90, reason: 'b', rank: 1 },
      { vehicleId: sedan.id, score: 60, reason: 'a', rank: 2 },
    ]);
    expect(match).toHaveBeenCalledWith(expect.objectContaining({ quantity: 2, vehicleType: '세단' }), 5);
    expect(repo.findBy).not.toHaveBeenCalled(); // 규칙 경로 미사용
  });

  it('rag: DB 에 없거나 가용이 아닌 vehicleId 는 버린다', async () => {
    const match = jest.fn().mockResolvedValue({
      model: 'm',
      candidates: [{ vehicleId: sedan.id, score: 60, reason: 'a' }, { vehicleId: g90.id, score: 90, reason: 'b' }],
    });
    const { m } = setup({ match, live: [sedan.id] });
    const out = await m.match(req);
    expect(out.results.map((r) => r.vehicleId)).toEqual([sedan.id]);
  });

  it.each([
    ['5xx/타임아웃', jest.fn().mockRejectedValue(new LlmClientError('LLM 서버 오류 (HTTP 500).'))],
    ['빈 결과', jest.fn().mockResolvedValue({ model: 'm', candidates: [] })],
  ])('rag: %s 이면 규칙 기반으로 폴백', async (_n, match) => {
    const { m, repo } = setup({ match });
    const out = await m.match(req);
    expect(out.source).toBe('rule');
    expect(out.results.length).toBeGreaterThan(0);
    expect(repo.findBy).toHaveBeenCalledWith({ status: 'AVAILABLE' });
  });

  it('rag: 후보가 전부 가용하지 않으면 규칙 기반으로 폴백', async () => {
    const match = jest.fn().mockResolvedValue({ model: 'm', candidates: [{ vehicleId: sedan.id, score: 60, reason: 'a' }] });
    const { m } = setup({ match, live: [] });
    expect((await m.match(req)).source).toBe('rule');
  });

  it('rule 모드: /match 를 호출하지 않는다', async () => {
    const { m, llm } = setup({ mode: 'rule' });
    const out = await m.match(req);
    expect(out.source).toBe('rule');
    expect(llm.match).not.toHaveBeenCalled();
  });

  it('matchMany: 동시 호출 5개 제한, 순서 유지, 규칙용 차량은 한 번만 조회', async () => {
    let active = 0;
    let peak = 0;
    const match = jest.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return { model: 'm', candidates: [] };
    });
    const { m, repo } = setup({ match });
    const outs = await m.matchMany(Array.from({ length: 12 }, () => req));
    expect(outs).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
    expect(repo.findBy).toHaveBeenCalledTimes(1);
  });
});
