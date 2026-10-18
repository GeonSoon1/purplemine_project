import { createServer, IncomingMessage, Server } from 'node:http';

/**
 * services/llm 계약(docs/api/llm.md)을 흉내 내는 최소 모킹 서버. e2e 와 수동 테스트용.
 * "S#번호. 장소 / 시간대" 헤더로 씬을 나누고 키워드로 차량 요구를 만든다.
 * /embed 는 384차원 결정적 벡터, /match 는 matchHandler(기본: 빈 후보)로 응답한다.
 * 본문에 "[FAIL]" 이 있으면 502, "[SLOW]" 면 응답을 지연한다.
 */
export interface MockLlm {
  server: Server;
  url: string;
  calls: Array<{ scriptId: string; textLength: number; hints: unknown }>;
  /** /embed 로 받은 texts, /match 로 받은 요청 기록 */
  embedCalls: Array<{ texts: string[]; kind: string }>;
  matchCalls: Array<{ requirement: Record<string, unknown>; topK: number }>;
  /** /embed 를 실패(503)시키려면 true */
  embedFail: boolean;
  /** /match 응답 제어. 기본은 빈 후보(=서비스가 규칙 기반으로 폴백). status 가 200 이 아니면 그 상태로 응답 */
  matchHandler: (body: { requirement: Record<string, unknown>; topK: number }) => { status?: number; candidates?: Array<{ vehicleId: string; score: number; reason: string }> };
  close(): Promise<void>;
}

const TIME: Record<string, string> = { 낮: 'DAY', 밤: 'NIGHT', 새벽: 'DAWN', 저녁: 'DUSK' };

export function analyzeText(scriptId: string, text: string, hints: unknown) {
  const parts = text.split(/(?=^S#\d+\.)/m).filter((p) => /^S#\d+\./.test(p));
  const scenes = parts.map((p) => {
    const m = /^S#(\d+)\.\s*([^/\n]*?)\s*\/\s*(\S+)/.exec(p)!;
    const vehicles: Array<Record<string, unknown>> = [];
    if (p.includes('제네시스 G90')) {
      vehicles.push({
        role: 'LEAD', vehicleType: '고급 세단', categoryHint: 'SEDAN', brandModelHint: '제네시스 G90',
        quantity: 1, usage: p.includes('추격') ? 'CHASE' : 'NORMAL', damageExpected: false,
        sourceQuote: '검은색 제네시스 G90', confidence: 0.93,
      });
    }
    if (p.includes('경차')) {
      vehicles.push({
        role: 'BACKGROUND', vehicleType: '경차', categoryHint: 'COMPACT', brandModelHint: null,
        quantity: 2, usage: 'NORMAL', damageExpected: false, sourceQuote: null, confidence: 0.7,
      });
    }
    if (p.includes('충돌')) {
      vehicles.push({
        role: 'SUPPORT', vehicleType: '승합차', categoryHint: 'VAN', brandModelHint: null,
        quantity: 1, usage: 'DAMAGE', damageExpected: true, sourceQuote: '충돌', confidence: 0.8,
      });
    }
    if (p.includes('헬리콥터')) {
      vehicles.push({
        role: 'SUPPORT', vehicleType: '특수 차량', categoryHint: null, brandModelHint: null,
        quantity: 1, usage: 'ACTION', damageExpected: false, sourceQuote: null, confidence: 0.4,
      });
    }
    return {
      sceneNo: Number(m[1]), location: m[2] || null, timeOfDay: TIME[m[3]] ?? 'UNKNOWN',
      summary: `씬 ${m[1]} 요약`, sourceText: p.trim(), shootDateHint: null, vehicles,
    };
  });
  return {
    scriptId, model: 'mock-rule-v1', promptVersion: 'v1', scenes,
    shootSchedule: { start: null, end: null, hints: hints ? ['요청 힌트 사용'] : [] },
  };
}

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

export async function startMockLlm(port = 0): Promise<MockLlm> {
  const calls: MockLlm['calls'] = [];
  const state = {
    embedCalls: [] as MockLlm['embedCalls'],
    matchCalls: [] as MockLlm['matchCalls'],
    embedFail: false,
    matchHandler: (() => ({ candidates: [] })) as MockLlm['matchHandler'],
  };
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.method === 'POST' && req.url === '/analyze') {
      const body = JSON.parse(await readBody(req)) as { scriptId: string; text: string; hints: unknown };
      calls.push({ scriptId: body.scriptId, textLength: body.text.length, hints: body.hints });
      if (body.text.includes('[SLOW]')) await new Promise((r) => setTimeout(r, 400));
      if (body.text.includes('[FAIL]')) {
        res.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'model failed' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(analyzeText(body.scriptId, body.text, body.hints)));
      return;
    }
    if (req.method === 'POST' && req.url === '/embed') {
      const body = JSON.parse(await readBody(req)) as { texts: string[]; kind: string };
      state.embedCalls.push(body);
      if (state.embedFail) {
        res.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'embedding model unavailable' }));
        return;
      }
      const embeddings = body.texts.map((t) => {
        const seed = [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 9973, 7);
        return Array.from({ length: 384 }, (_, i) => ((seed + i * 13) % 100) / 100);
      });
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'mock-e5-small', dimension: 384, embeddings }));
      return;
    }
    if (req.method === 'POST' && req.url === '/match') {
      const body = JSON.parse(await readBody(req)) as { requirement: Record<string, unknown>; topK: number };
      state.matchCalls.push(body);
      const out = state.matchHandler(body);
      if (out.status && out.status !== 200) {
        res.writeHead(out.status, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: 'match failed' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ model: 'mock-e5-small', candidates: out.candidates ?? [] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  return {
    server,
    calls,
    url: `http://127.0.0.1:${actual}`,
    embedCalls: state.embedCalls,
    matchCalls: state.matchCalls,
    get embedFail() { return state.embedFail; },
    set embedFail(v: boolean) { state.embedFail = v; },
    get matchHandler() { return state.matchHandler; },
    set matchHandler(v: MockLlm['matchHandler']) { state.matchHandler = v; },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (require.main === module) {
  void startMockLlm(Number(process.env.PORT ?? 8000)).then((m) => console.log(`mock LLM server: ${m.url}`));
}
