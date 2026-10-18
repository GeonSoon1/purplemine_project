import { LlmClient, LlmClientError, parseAnalyzeResponse } from './llm.client';

const valid = {
  scriptId: 's1',
  model: 'mock-rule-v1',
  promptVersion: 'v1',
  scenes: [
    {
      sceneNo: 1, location: '도로', timeOfDay: 'DAY', summary: 'x', sourceText: 'S#1.', shootDateHint: '2026-11-03',
      vehicles: [{ role: 'LEAD', vehicleType: '세단', categoryHint: 'SEDAN', brandModelHint: null, quantity: 2, usage: 'CHASE', damageExpected: false, sourceQuote: null, confidence: 0.5 }],
    },
  ],
  shootSchedule: { start: null, end: null, hints: ['a'] },
};

describe('parseAnalyzeResponse', () => {
  it('계약대로의 응답을 통과시킨다', () => {
    const r = parseAnalyzeResponse(valid);
    expect(r.scenes[0].vehicles[0].quantity).toBe(2);
    expect(r.scenes[0].shootDateHint).toBe('2026-11-03');
    expect(r.shootSchedule.hints).toEqual(['a']);
  });
  it('알 수 없는 timeOfDay 는 UNKNOWN, 잘못된 날짜는 null', () => {
    const r = parseAnalyzeResponse({ ...valid, scenes: [{ ...valid.scenes[0], timeOfDay: 'NOON', shootDateHint: '2026-13-40' }] });
    expect(r.scenes[0].timeOfDay).toBe('UNKNOWN');
    expect(r.scenes[0].shootDateHint).toBeNull();
  });
  it('씬 번호 중복/필수 필드 누락은 LlmClientError', () => {
    expect(() => parseAnalyzeResponse({ ...valid, scenes: [valid.scenes[0], valid.scenes[0]] })).toThrow(LlmClientError);
    expect(() => parseAnalyzeResponse({})).toThrow(LlmClientError);
    expect(() =>
      parseAnalyzeResponse({ ...valid, scenes: [{ ...valid.scenes[0], vehicles: [{ ...valid.scenes[0].vehicles[0], role: 'BOSS' }] }] }),
    ).toThrow(LlmClientError);
  });
  it('shootSchedule 누락 시 기본값', () => {
    const { shootSchedule: _s, ...rest } = valid;
    expect(parseAnalyzeResponse(rest).shootSchedule).toEqual({ start: null, end: null, hints: [] });
  });
});

describe('LlmClient', () => {
  const config = { get: (k: string) => (k === 'llmServerUrl' ? 'http://llm.test' : 50) } as never;
  afterEach(() => jest.restoreAllMocks());

  it('POST /analyze 호출 후 파싱', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify(valid), { status: 200 }));
    const out = await new LlmClient(config).analyze({ scriptId: 's1', text: 't', hints: null });
    expect(out.model).toBe('mock-rule-v1');
    expect(fetchMock.mock.calls[0][0]).toBe('http://llm.test/analyze');
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST');
  });
  it('HTTP 오류는 상태 코드만 담은 LlmClientError (본문 미노출)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{"detail":"대본 내용 포함"}', { status: 502 }));
    await expect(new LlmClient(config).analyze({ scriptId: 's', text: 't', hints: null })).rejects.toThrow('LLM 서버 오류 (HTTP 502).');
  });
  it('연결 실패 / 타임아웃', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(new LlmClient(config).analyze({ scriptId: 's', text: 't', hints: null })).rejects.toThrow('연결할 수 없습니다');
    const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
    jest.spyOn(global, 'fetch').mockRejectedValueOnce(timeout);
    await expect(new LlmClient(config).analyze({ scriptId: 's', text: 't', hints: null })).rejects.toThrow('시간이 초과');
  });
});

describe('parseEmbedResponse / parseMatchResponse', () => {
  const { parseEmbedResponse, parseMatchResponse } = jest.requireActual('./llm.client') as typeof import('./llm.client');
  const vec = Array.from({ length: 384 }, () => 0.1);

  it('embed: 개수·차원이 맞으면 통과, 아니면 LlmClientError', () => {
    expect(parseEmbedResponse({ model: 'e5', dimension: 384, embeddings: [vec] }, 1).model).toBe('e5');
    expect(() => parseEmbedResponse({ model: 'e5', embeddings: [vec] }, 2)).toThrow(LlmClientError);
    expect(() => parseEmbedResponse({ model: 'e5', embeddings: [[1, 2]] }, 1)).toThrow(LlmClientError);
  });

  it('match: 점수는 0~100 정수로 보정하고 형식이 틀린 후보는 버린다', () => {
    const r = parseMatchResponse({ model: 'm', candidates: [{ vehicleId: 'a', score: 87.6, reason: 'x' }, { vehicleId: 1 }, { vehicleId: 'b', score: 150 }] });
    expect(r.candidates).toEqual([
      { vehicleId: 'a', score: 88, reason: 'x' },
      { vehicleId: 'b', score: 100, reason: '' },
    ]);
    expect(() => parseMatchResponse({})).toThrow(LlmClientError);
  });
});
