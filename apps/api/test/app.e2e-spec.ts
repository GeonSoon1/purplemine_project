import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import request from 'supertest';
import { startMockLlm, MockLlm } from './mock-llm-server';

/**
 * e2e: 실제 PostgreSQL(pgvector) + 모킹 LLM 서버.
 * DB 는 TEST_DATABASE_URL (기본: 로컬 docker-compose 의 purplemine_test, 매 실행 시 스키마 초기화).
 * DB 에 연결할 수 없으면 테스트는 경고만 남기고 통과 처리한다.
 */
const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://purplemine:purplemine@localhost:5433/purplemine_test';

let app: INestApplication;
let llm: MockLlm;
let storageDir: string;
let dbOk = false;
let http: ReturnType<typeof request>;

const t = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!dbOk) {
      console.warn(`[e2e] DB 없음 - 건너뜀: ${name}`);
      return;
    }
    await fn();
  });

async function prepareDatabase(): Promise<boolean> {
  const url = new URL(TEST_URL);
  const dbName = url.pathname.slice(1);
  const admin = new Client({ connectionString: TEST_URL.replace(`/${dbName}`, '/postgres'), connectionTimeoutMillis: 2000 });
  try {
    await admin.connect();
  } catch {
    return false;
  }
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const c = new Client({ connectionString: TEST_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  return true;
}

const waitStatus = async (id: string, want: string[], tries = 50) => {
  for (let i = 0; i < tries; i++) {
    const res = await http.get(`/api/scripts/${id}`);
    if (want.includes(res.body.status)) return res.body;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`script ${id} did not reach ${want.join('/')}`);
};

const upload = (text: string, extra: Record<string, string> = {}, filename = '서울의 밤.txt') => {
  const r = http
    .post('/api/scripts')
    .field('title', extra.title ?? '서울의 밤')
    .field('productionCompany', extra.productionCompany ?? '한빛스튜디오');
  for (const [k, v] of Object.entries(extra)) if (k !== 'title' && k !== 'productionCompany') r.field(k, v);
  return r.attach('file', Buffer.from(text, 'utf8'), { filename, contentType: 'text/plain' });
};

const SCRIPT_TEXT = [
  'S#1. 서울 도심 / 낮',
  '검은색 제네시스 G90이 도착한다. 추격 장면.',
  'S#2. 주차장 / 밤',
  '경차 두 대가 주차되어 있다.',
  'S#3. 고속도로 / 낮',
  '승합차가 충돌한다.',
  'S#4. 옥상 / 밤',
  '헬리콥터가 착륙한다.',
].join('\n');

const vehicle = (o: Record<string, unknown>) => http.post('/api/vehicles').send(o);

describe('API e2e', () => {
  const state: Record<string, any> = {};

  beforeAll(async () => {
    dbOk = await prepareDatabase();
    if (!dbOk) return;
    llm = await startMockLlm();
    storageDir = mkdtempSync(join(tmpdir(), 'purplemine-scripts-'));
    process.env.DATABASE_URL = TEST_URL;
    process.env.DB_MIGRATIONS_RUN = 'true';
    process.env.SCRIPT_STORAGE_DIR = storageDir;
    process.env.LLM_SERVER_URL = llm.url;
    process.env.LLM_TIMEOUT_MS = '5000';

    const { AppModule } = await import('../src/app.module');
    const { setupApp } = await import('../src/app.setup');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    setupApp(app, ['http://localhost:3000']);
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    await llm?.close();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  // ───────── 공통 ─────────
  t('없는 경로/잘못된 UUID/검증 실패가 공통 오류 형식으로 내려간다', async () => {
    const nf = await http.get('/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.body).toEqual(expect.objectContaining({ statusCode: 404, error: 'Not Found' }));

    const bad = await http.get('/api/scripts/not-a-uuid');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Bad Request');

    const invalid = await vehicle({ plateNo: '' });
    expect(invalid.status).toBe(400);
    expect(Array.isArray(invalid.body.message)).toBe(true);
  });

  t('CORS: localhost:3000 허용', async () => {
    const res = await http.options('/api/vehicles').set('Origin', 'http://localhost:3000').set('Access-Control-Request-Method', 'GET');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
  });

  // ───────── 차량 ─────────
  t('차량 등록: description 자동 생성, 번호판 중복 409', async () => {
    const mk = async (key: string, o: Record<string, unknown>) => {
      const res = await vehicle({ year: 2023, dailyRate: 100000, ...o });
      expect(res.status).toBe(201);
      state[key] = res.body;
    };
    await mk('g90', { plateNo: '12하 3456', brand: '제네시스', model: 'G90', category: 'SEDAN', color: '검정', damageAllowed: false, dailyRate: 220000 });
    await mk('g80', { plateNo: '13하 3456', brand: '제네시스', model: 'G80', category: 'SEDAN', color: '검정', damageAllowed: false, dailyRate: 180000 });
    await mk('sonata', { plateNo: '14하 3456', brand: '현대', model: '쏘나타', category: 'SEDAN', color: '흰색', damageAllowed: true, dailyRate: 90000 });
    await mk('morning', { plateNo: '15하 3456', brand: '기아', model: '모닝', category: 'COMPACT', color: '흰색', damageAllowed: true, dailyRate: 60000 });
    await mk('ray', { plateNo: '16하 3456', brand: '기아', model: '레이', category: 'COMPACT', color: '은색', damageAllowed: true, dailyRate: 70000 });
    await mk('casper', { plateNo: '17하 3456', brand: '현대', model: '캐스퍼', category: 'COMPACT', color: '주황', damageAllowed: false, dailyRate: 75000 });
    await mk('carnival', { plateNo: '18하 3456', brand: '기아', model: '카니발', category: 'VAN', color: '검정', damageAllowed: true, dailyRate: 150000 });
    await mk('parked', { plateNo: '19하 3456', brand: '현대', model: '아반떼', category: 'SEDAN', color: '검정', damageAllowed: true, status: 'MAINTENANCE' });

    expect(state.g90.description).toBe('제네시스 G90 2023년식 검정 세단');
    expect(state.g90).not.toHaveProperty('embedding');
    expect(state.g90).not.toHaveProperty('embeddingModel');
    expect(typeof state.g90.dailyRate).toBe('number');
    expect(state.g90.status).toBe('AVAILABLE');

    const dup = await vehicle({ plateNo: '12하 3456', brand: 'x', model: 'y', year: 2020, category: 'SUV', dailyRate: 1 });
    expect(dup.status).toBe(409);
  });

  t('차량 목록/검색/요약/수정', async () => {
    const list = await http.get('/api/vehicles?q=제네시스&pageSize=10');
    expect(list.body).toEqual(expect.objectContaining({ page: 1, pageSize: 10, total: 2 }));
    expect(list.body.items.map((v: any) => v.model)).toEqual(['G80', 'G90']);

    const dmg = await http.get('/api/vehicles?damageAllowed=true&category=COMPACT');
    expect(dmg.body.total).toBe(2);

    const summary = await http.get('/api/vehicles/summary');
    expect(summary.body.total).toBe(7); // MAINTENANCE 제외
    expect(summary.body.byCategory).toEqual({ COMPACT: 3, SEDAN: 3, SUV: 0, VAN: 1, TRUCK: 0, SPORTS: 0, CLASSIC: 0, OTHER: 0 });

    const patched = await http.patch(`/api/vehicles/${state.sonata.id}`).send({ color: '검정', dailyRate: 95000 });
    expect(patched.status).toBe(200);
    expect(patched.body.dailyRate).toBe(95000);
    expect(patched.body.description).toBe('현대 쏘나타 2023년식 검정 세단'); // 자동 생성 설명은 같이 갱신

    expect((await http.get(`/api/vehicles?pageSize=101`)).status).toBe(400);
    expect((await http.get(`/api/vehicles/${'0'.repeat(8)}-0000-4000-8000-000000000000`)).status).toBe(404);
  });

  // ───────── 대본 업로드/분석 ─────────
  t('업로드 검증: 형식 415, 용량 413, 필수값 400, 기간 역전 400', async () => {
    const png = await http.post('/api/scripts').field('title', 'a').field('productionCompany', 'b').attach('file', Buffer.from('x'), { filename: 'a.png' });
    expect(png.status).toBe(415);

    const big = await http.post('/api/scripts').field('title', 'a').field('productionCompany', 'b').attach('file', Buffer.alloc(10 * 1024 * 1024 + 10, 'a'), { filename: 'big.txt' });
    expect(big.status).toBe(413);

    const noTitle = await http.post('/api/scripts').attach('file', Buffer.from('S#1. a / 낮'), { filename: 'a.txt' });
    expect(noTitle.status).toBe(400);

    const noFile = await http.post('/api/scripts').field('title', 'a').field('productionCompany', 'b');
    expect(noFile.status).toBe(400);

    const range = await upload(SCRIPT_TEXT, { shootStart: '2026-11-10', shootEnd: '2026-11-03' });
    expect(range.status).toBe(400);

    const empty = await upload('   ');
    expect(empty.status).toBe(400);
    // 실패한 업로드가 파일을 남기지 않는다
    expect(readdirSync(storageDir)).toHaveLength(0);
  });

  t('업로드 → 백그라운드 분석 → ANALYZED, 원본은 uuid 이름으로 저장', async () => {
    const res = await upload(SCRIPT_TEXT, { shootStart: '2026-11-03', shootEnd: '2026-11-21' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(
      expect.objectContaining({
        status: 'ANALYZING',
        fileName: '서울의 밤.txt',
        fileType: 'txt',
        shootStart: '2026-11-03',
        shootEnd: '2026-11-21',
        errorMessage: null,
        sceneCount: 0,
      }),
    );
    expect(res.body).not.toHaveProperty('filePath');
    state.scriptId = res.body.id;

    const done = await waitStatus(state.scriptId, ['ANALYZED', 'FAILED']);
    expect(done.status).toBe('ANALYZED');
    expect(done.analysisModel).toBe('mock-rule-v1');
    expect(done.promptVersion).toBe('v1');
    expect(done.sceneCount).toBe(4);
    expect(done.requirementCount).toBe(4);
    expect(llm.calls.at(-1)?.hints).toEqual({ shootStart: '2026-11-03', shootEnd: '2026-11-21' });

    const files = readdirSync(storageDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f-]{36}\.txt$/);
  });

  t('분석 결과 조회: 씬/요구사항/후보, 자동 선택 없음', async () => {
    const res = await http.get(`/api/scripts/${state.scriptId}/analysis`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ANALYZED');
    expect(res.body.shootSchedule).toEqual({ start: null, end: null, hints: ['요청 힌트 사용'] });
    expect(res.body.summary).toEqual({ requirementCount: 4, selectedCount: 0, noCandidateCount: 1, pendingCount: 3 });
    expect(res.body.scenes.map((s: any) => s.sceneNo)).toEqual([1, 2, 3, 4]);

    const [s1, s2, s3, s4] = res.body.scenes;
    const g90Req = s1.requirements[0];
    expect(g90Req).toEqual(expect.objectContaining({ sceneNo: 1, role: 'LEAD', brandModelHint: '제네시스 G90', selectedCount: 0, confidence: 0.93 }));
    expect(g90Req.candidates[0]).toEqual(
      expect.objectContaining({ vehicleId: state.g90.id, score: 100, rank: 1, isSelected: false }),
    );
    expect(g90Req.candidates[0].reason).toContain('차명이 대본과 일치');
    expect(g90Req.candidates[0].vehicle).toEqual(expect.objectContaining({ plateNo: '12하 3456', dailyRate: 220000, damageAllowed: false }));
    // G80 은 브랜드만 일치
    expect(g90Req.candidates.map((c: any) => c.vehicle.model).slice(0, 2)).toEqual(['G90', 'G80']);

    // 경차 2대: 경차 3대가 후보, 정비중/타 분류 제외
    const compact = s2.requirements[0];
    expect(compact.quantity).toBe(2);
    expect(compact.candidates.map((c: any) => c.vehicle.category)).toEqual(['COMPACT', 'COMPACT', 'COMPACT']);

    // 파손 예상: 파손 불가 차량 제외
    const damage = s3.requirements[0];
    expect(damage.candidates.map((c: any) => c.vehicleId)).toEqual([state.carnival.id]);
    expect(damage.candidates[0].reason).toContain('파손 촬영 가능');

    expect(s4.requirements[0].candidates).toEqual([]);
    state.analysis = res.body;
  });

  t('목록/필터', async () => {
    const list = await http.get('/api/scripts?status=ANALYZED&q=서울');
    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect(list.body.items[0]).toEqual(expect.objectContaining({ id: state.scriptId, sceneCount: 4, requirementCount: 4 }));
    expect((await http.get('/api/scripts?status=BOGUS')).status).toBe(400);
  });

  t('LLM 서버 실패 → FAILED + errorMessage, 재분석은 가능', async () => {
    const res = await upload('S#1. a / 낮\n[FAIL]', {}, 'fail.txt');
    expect(res.status).toBe(201);
    const failed = await waitStatus(res.body.id, ['FAILED', 'ANALYZED']);
    expect(failed.status).toBe('FAILED');
    expect(failed.errorMessage).toContain('LLM 서버 오류');
    expect(failed.errorMessage).not.toContain('model failed');

    const analysis = await http.get(`/api/scripts/${res.body.id}/analysis`);
    expect(analysis.body.scenes).toEqual([]);

    const re = await http.post(`/api/scripts/${res.body.id}/analyze`);
    expect(re.status).toBe(202);
    expect(re.body.status).toBe('ANALYZING');
    expect(re.body.errorMessage).toBeNull();
    await waitStatus(res.body.id, ['FAILED']);
    expect((await http.delete(`/api/scripts/${res.body.id}`)).status).toBe(204);
  });

  t('분석 중: 재분석/삭제 409', async () => {
    const res = await upload('S#1. a / 낮\n[SLOW]', {}, 'slow.txt');
    expect(res.body.status).toBe('ANALYZING');
    expect((await http.post(`/api/scripts/${res.body.id}/analyze`)).status).toBe(409);
    expect((await http.delete(`/api/scripts/${res.body.id}`)).status).toBe(409);
    await waitStatus(res.body.id, ['ANALYZED']);
    expect((await http.delete(`/api/scripts/${res.body.id}`)).status).toBe(204);
  });

  t('재시작 시 ANALYZING 으로 남은 건은 FAILED 처리', async () => {
    const { AnalysisRunner } = await import('../src/analysis/analysis-runner.service');
    const { DataSource } = await import('typeorm');
    const ds = app.get(DataSource);
    const [row] = await ds.query(
      `INSERT INTO scripts (title, production_company, file_name, file_path, file_type, file_size, status)
       VALUES ('stuck','p','a.txt','/nonexistent','txt',1,'ANALYZING') RETURNING id`,
    );
    await app.get(AnalysisRunner).onApplicationBootstrap();
    const res = await http.get(`/api/scripts/${row.id}`);
    expect(res.body.status).toBe('FAILED');
    expect(res.body.errorMessage).toContain('재시작');
    await http.delete(`/api/scripts/${row.id}`);
  });

  // ───────── 요구사항/선택 ─────────
  t('선택: 대수 초과 400, 없는 차량 404, 직접 선택 후보 추가', async () => {
    const [, s2] = state.analysis.scenes;
    const compact = s2.requirements[0];
    state.compactReq = compact.id;

    const tooMany = await http.put(`/api/requirements/${compact.id}/selection`).send({
      vehicleIds: compact.candidates.map((c: any) => c.vehicleId),
    });
    expect(tooMany.status).toBe(400);

    const ghost = await http.put(`/api/requirements/${compact.id}/selection`).send({ vehicleIds: ['11111111-1111-4111-8111-111111111111'] });
    expect(ghost.status).toBe(404);

    // 후보 1개 + 후보에 없는 sonata(직접 선택)
    const ok = await http.put(`/api/requirements/${compact.id}/selection`).send({
      vehicleIds: [compact.candidates[0].vehicleId, state.sonata.id],
    });
    expect(ok.status).toBe(200);
    expect(ok.body.selectedCount).toBe(2);
    const manual = ok.body.candidates.find((c: any) => c.vehicleId === state.sonata.id);
    expect(manual).toEqual(expect.objectContaining({ score: 0, reason: '직접 선택', isSelected: true }));
    expect(manual.rank).toBe(4);

    // 직접 선택을 해제하면 그 후보는 사라진다
    const less = await http.put(`/api/requirements/${compact.id}/selection`).send({ vehicleIds: [compact.candidates[0].vehicleId] });
    expect(less.body.candidates).toHaveLength(3);
    expect(less.body.selectedCount).toBe(1);
  });

  t('요구사항 수정 → candidatesStale, rematch 는 선택 유지', async () => {
    const id = state.compactReq;
    const qtyOnly = await http.patch(`/api/requirements/${id}`).send({ quantity: 2 });
    expect(qtyOnly.status).toBe(200);
    expect(qtyOnly.body).not.toHaveProperty('candidatesStale');
    expect(qtyOnly.body.isUserEdited).toBe(true);

    const edited = await http.patch(`/api/requirements/${id}`).send({ vehicleType: '소형차', categoryHint: 'COMPACT', brandModelHint: '기아 레이' });
    expect(edited.body.candidatesStale).toBe(true);
    expect(edited.body.selectedCount).toBe(1); // 자동 재계산 안 함

    // 차종 문구만 바꾸고 분류를 안 보내면 문구에서 분류를 다시 추정 (못 찾으면 null)
    const infer = await http.patch(`/api/requirements/${id}`).send({ vehicleType: '승합차' });
    expect(infer.body.categoryHint).toBe('VAN');
    const unknown = await http.patch(`/api/requirements/${id}`).send({ vehicleType: '정체불명 탈것' });
    expect(unknown.body.categoryHint).toBeNull();
    const keep = await http.patch(`/api/requirements/${id}`).send({ vehicleType: '소형차', categoryHint: 'COMPACT' });
    expect(keep.body.categoryHint).toBe('COMPACT'); // 명시한 분류는 그대로

    const bad = await http.patch(`/api/requirements/${id}`).send({ quantity: 0 });
    expect(bad.status).toBe(400);
    expect((await http.patch(`/api/requirements/${id}`).send({ role: null })).status).toBe(400);

    const selectedBefore = edited.body.candidates.find((c: any) => c.isSelected).vehicleId;
    const re = await http.post(`/api/requirements/${id}/rematch`);
    expect(re.status).toBe(200);
    expect(re.body.candidates[0].vehicle.model).toBe('레이'); // 차명 일치가 1순위
    expect(re.body.candidates[0].reason).toContain('차명이 대본과 일치');
    const selectedAfter = re.body.candidates.filter((c: any) => c.isSelected).map((c: any) => c.vehicleId);
    expect(selectedAfter).toEqual([selectedBefore]);
    state.compactSelected = selectedBefore;
  });

  t('차량 임베딩: 등록 시 저장되고, 서버가 죽어도 등록은 성공(null 유지)', async () => {
    const db = new Client({ connectionString: TEST_URL });
    await db.connect();
    try {
      const row = await db.query('SELECT embedding IS NOT NULL AS has, embedding_model AS model FROM vehicles WHERE id = $1', [state.g90.id]);
      expect(row.rows[0]).toEqual({ has: true, model: 'mock-e5-small' });
      expect(llm.embedCalls.some((c) => c.kind === 'passage' && c.texts[0] === state.g90.description)).toBe(true);

      llm.embedFail = true;
      const res = await vehicle({ plateNo: '20하 3456', brand: '현대', model: '포터', year: 2022, category: 'TRUCK', dailyRate: 80000 });
      expect(res.status).toBe(201);
      const nul = await db.query('SELECT embedding IS NULL AS isnull FROM vehicles WHERE id = $1', [res.body.id]);
      expect(nul.rows[0].isnull).toBe(true);

      // 설명 변경 + 임베딩 서버 장애: 수정은 성공하고 낡은 벡터는 남지 않는다
      const patched = await http.patch(`/api/vehicles/${state.casper.id}`).send({ description: '노란 경차 캐스퍼' });
      expect(patched.status).toBe(200);
      const stale = await db.query('SELECT embedding IS NULL AS isnull, embedding_model AS model FROM vehicles WHERE id = $1', [state.casper.id]);
      expect(stale.rows[0]).toEqual({ isnull: true, model: null });
      llm.embedFail = false;

      // 설명이 안 바뀌면 재임베딩하지 않는다
      const before = llm.embedCalls.length;
      await http.patch(`/api/vehicles/${state.casper.id}`).send({ dailyRate: 76000 });
      expect(llm.embedCalls.length).toBe(before);
      // 정리: 이 테스트에서 만든 차량이 이후 집계에 끼지 않게 삭제
      expect((await http.delete(`/api/vehicles/${res.body.id}`)).status).toBe(204);
    } finally {
      await db.end();
    }
  });

  t('후보 매칭: /match 결과 우선, 5xx·빈 결과면 규칙 기반 폴백', async () => {
    const id = state.compactReq;
    const call = async () => (await http.post(`/api/requirements/${id}/rematch`)).body;

    // 1) RAG: 모닝을 77점으로 반환 (점수 내림차순으로 rank, 가용하지 않은 차량은 버려진다)
    llm.matchHandler = () => ({
      candidates: [
        { vehicleId: state.ray.id, score: 55, reason: 'RAG: 레이 유사' },
        { vehicleId: state.morning.id, score: 77, reason: 'RAG: 모닝 유사' },
        { vehicleId: state.parked.id, score: 99, reason: '정비중 차량' },
        { vehicleId: '11111111-1111-4111-8111-111111111111', score: 98, reason: '없는 차량' },
      ],
    });
    llm.matchCalls.length = 0;
    const rag = await call();
    expect(llm.matchCalls).toHaveLength(1);
    expect(llm.matchCalls[0].topK).toBe(5);
    expect(llm.matchCalls[0].requirement).toEqual(expect.objectContaining({ vehicleType: '소형차', categoryHint: 'COMPACT', usage: 'NORMAL', damageExpected: false, quantity: 2 }));
    expect(rag.candidates.map((c: any) => [c.rank, c.vehicle.model, c.score, c.reason])).toEqual([
      [1, '모닝', 77, 'RAG: 모닝 유사'],
      [2, '레이', 55, 'RAG: 레이 유사'],
    ]);
    expect(rag.candidates[0].vehicle).toEqual(expect.objectContaining({ plateNo: '15하 3456', category: 'COMPACT' }));

    // 2) 5xx -> 규칙 기반 (차명 일치가 1순위)
    llm.matchHandler = () => ({ status: 500 });
    const fb = await call();
    expect(fb.candidates[0].vehicle.model).toBe('레이');
    expect(fb.candidates[0].reason).toContain('차명이 대본과 일치');

    // 3) 빈 결과 -> 규칙 기반
    llm.matchHandler = () => ({ candidates: [] });
    expect((await call()).candidates[0].reason).toContain('차명이 대본과 일치');
  });

  t('요구사항 수동 추가/삭제', async () => {
    const sceneId = state.analysis.scenes[3].id;
    const bad = await http.post(`/api/scripts/${state.scriptId}/requirements`).send({ sceneId: '11111111-1111-4111-8111-111111111111', role: 'BACKGROUND', vehicleType: '경차', quantity: 1, usage: 'NORMAL' });
    expect(bad.status).toBe(404);

    const res = await http.post(`/api/scripts/${state.scriptId}/requirements`).send({ sceneId, role: 'BACKGROUND', vehicleType: '경차', categoryHint: 'COMPACT', quantity: 1, usage: 'NORMAL' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ isUserEdited: true, confidence: null, sceneNo: 4, brandModelHint: null, damageExpected: false }));
    expect(res.body.candidates.length).toBe(3);
    expect((await http.delete(`/api/requirements/${res.body.id}`)).status).toBe(204);
    expect((await http.delete(`/api/requirements/${res.body.id}`)).status).toBe(404);
  });

  // ───────── 견적서 ─────────
  t('견적서 생성: 선택 항목 + 차량 미정 항목, 합계 계산', async () => {
    // G90 선택
    const g90Req = state.analysis.scenes[0].requirements[0].id;
    expect((await http.put(`/api/requirements/${g90Req}/selection`).send({ vehicleIds: [state.g90.id] })).status).toBe(200);

    const bad = await http.post('/api/quotes').send({ scriptId: '11111111-1111-4111-8111-111111111111' });
    expect(bad.status).toBe(404);

    const res = await http.post('/api/quotes').send({ scriptId: state.scriptId, author: '김민지', validUntil: '2026-11-18' });
    expect(res.status).toBe(201);
    const q = res.body;
    state.quote = q;
    expect(q).toEqual(
      expect.objectContaining({
        quoteNo: expect.stringMatching(/^Q-\d{4}-0001$/),
        version: 1,
        status: 'DRAFT',
        scriptId: state.scriptId,
        title: '서울의 밤',
        productionCompany: '한빛스튜디오',
        periodStart: '2026-11-03',
        periodEnd: '2026-11-21',
        days: 19,
        author: '김민지',
        validUntil: '2026-11-18',
      }),
    );
    // 항목: G90(1) + 경차 선택1 + 경차 미정(1대) + 승합 미정(1대) + 특수 차량 미정(1대)
    expect(q.items).toHaveLength(5);
    const g90Item = q.items[0];
    expect(g90Item).toEqual(
      expect.objectContaining({ vehicleId: state.g90.id, requirementId: g90Req, role: 'LEAD', usage: 'CHASE', sceneNos: [1], quantity: 1, days: 19, unitPrice: 220000, subtotal: 220000 * 19 }),
    );
    expect(g90Item.vehicle).toEqual({ plateNo: '12하 3456', brand: '제네시스', model: 'G90', year: 2023, color: '검정', category: 'SEDAN' });
    const unassigned = q.items.filter((i: any) => i.vehicleId === null);
    expect(unassigned).toHaveLength(3);
    expect(unassigned[0]).toEqual(expect.objectContaining({ vehicle: null, unitPrice: 0, subtotal: 0, label: '소형차 1대 필요' }));
    expect(q.unassignedCount).toBe(3);

    const compactItem = q.items.find((i: any) => i.vehicleId === state.compactSelected);
    const supply = 220000 * 19 + compactItem.unitPrice * 19;
    expect(q.supplyAmount).toBe(supply);
    expect(q.taxAmount).toBe(Math.floor(supply * 0.1));
    expect(q.totalAmount).toBe(supply + Math.floor(supply * 0.1));
  });

  t('견적서 항목 추가/수정/삭제 → 합계 재계산', async () => {
    const id = state.quote.id;
    const noLabel = await http.post(`/api/quotes/${id}/items`).send({ quantity: 1 });
    expect(noLabel.status).toBe(400);

    const added = await http.post(`/api/quotes/${id}/items`).send({
      vehicleId: state.sonata.id, role: 'SUPPORT', usage: 'NORMAL', quantity: 2,
      startDate: '2026-11-03', endDate: '2026-11-05', extraAmount: 50000, sceneNos: [2, 3],
    });
    expect(added.status).toBe(201);
    const item = added.body.items.at(-1);
    expect(item).toEqual(expect.objectContaining({ requirementId: null, days: 3, unitPrice: 95000, subtotal: 95000 * 2 * 3 + 50000, sceneNos: [2, 3] }));

    const wrongDates = await http.patch(`/api/quotes/${id}/items/${item.id}`).send({ startDate: '2026-11-10', endDate: '2026-11-05' });
    expect(wrongDates.status).toBe(400);

    // 차량 미정 항목에 차량 지정 -> 단가 자동 갱신
    const unassigned = state.quote.items.find((i: any) => i.vehicleId === null);
    const filled = await http.patch(`/api/quotes/${id}/items/${unassigned.id}`).send({ vehicleId: state.carnival.id });
    expect(filled.status).toBe(200);
    expect(filled.body.unassignedCount).toBe(2);
    const filledItem = filled.body.items.find((i: any) => i.id === unassigned.id);
    expect(filledItem.unitPrice).toBe(150000);
    expect(filledItem.subtotal).toBe(150000 * filledItem.quantity * 19);

    // 같은 요청에 unitPrice 가 있으면 그 값 우선
    const override = await http.patch(`/api/quotes/${id}/items/${unassigned.id}`).send({ vehicleId: state.carnival.id, unitPrice: 100000, extraAmount: 1 });
    expect(override.body.items.find((i: any) => i.id === unassigned.id).subtotal).toBe(100000 * filledItem.quantity * 19 + 1);

    const sum = override.body.items.reduce((s: number, i: any) => s + i.subtotal, 0);
    expect(override.body.supplyAmount).toBe(sum);
    expect(override.body.taxAmount).toBe(Math.floor(sum * 0.1));
    expect(override.body.totalAmount).toBe(sum + Math.floor(sum * 0.1));

    const del = await http.delete(`/api/quotes/${id}/items/${item.id}`);
    expect(del.status).toBe(200);
    expect(del.body.items.find((i: any) => i.id === item.id)).toBeUndefined();
    expect((await http.delete(`/api/quotes/${id}/items/${item.id}`)).status).toBe(404);
    state.quote = del.body;
  });

  t('견적서 사용 중인 차량은 삭제 409', async () => {
    expect((await http.delete(`/api/vehicles/${state.g90.id}`)).status).toBe(409);
    // 후보로만 있던 차량은 삭제 가능 (후보도 함께 삭제)
    expect((await http.delete(`/api/vehicles/${state.casper.id}`)).status).toBe(204);
  });

  t('견적서 일괄 저장: 한 번에 반영, 하나라도 실패하면 전부 롤백', async () => {
    const id = state.quote.id;
    const before = (await http.get(`/api/quotes/${id}`)).body;
    const [a, b] = before.items;
    const missing = '00000000-0000-4000-8000-000000000000';

    // 존재하지 않는 항목이 섞이면 404, 앞선 헤더/항목 변경도 반영되지 않는다
    const bad = await http.post(`/api/quotes/${id}/save`).send({
      header: { memo: '롤백 확인' },
      items: { update: [{ id: a.id, extraAmount: 999 }, { id: missing, quantity: 1 }] },
    });
    expect(bad.status).toBe(404);
    // 검증 오류(400)도 아무것도 반영하지 않는다
    expect((await http.post(`/api/quotes/${id}/save`).send({ items: { update: [{ id: a.id, quantity: 0 }] } })).status).toBe(400);
    const unchanged = (await http.get(`/api/quotes/${id}`)).body;
    expect(unchanged.memo).toBe(before.memo);
    expect(unchanged.totalAmount).toBe(before.totalAmount);
    expect(unchanged.items.find((i: any) => i.id === a.id).extraAmount).toBe(a.extraAmount);

    // 헤더 + 항목 수정/삭제/추가를 한 번에
    const ok = await http.post(`/api/quotes/${id}/save`).send({
      header: { memo: '일괄 저장', validUntil: '2026-12-31' },
      items: { update: [{ id: a.id, extraAmount: 10000 }], remove: [b.id], add: [{ label: '추가 미정', quantity: 1 }] },
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(expect.objectContaining({ memo: '일괄 저장', validUntil: '2026-12-31', isLatest: true }));
    expect(ok.body.items).toHaveLength(before.items.length);
    expect(ok.body.items.find((i: any) => i.id === b.id)).toBeUndefined();
    expect(ok.body.items.find((i: any) => i.id === a.id).extraAmount).toBe(10000);
    expect(ok.body.items[ok.body.items.length - 1]).toEqual(expect.objectContaining({ label: '추가 미정', vehicleId: null }));
    const sum = ok.body.items.reduce((acc: number, i: any) => acc + i.subtotal, 0);
    expect(ok.body.supplyAmount).toBe(sum);
    expect(ok.body.totalAmount).toBe(sum + Math.floor(sum * 0.1));

    // 빈 요청은 변경 없이 현재 견적서를 돌려준다
    const empty = await http.post(`/api/quotes/${id}/save`).send({});
    expect(empty.status).toBe(200);
    expect(empty.body.totalAmount).toBe(ok.body.totalAmount);
    expect((await http.post(`/api/quotes/${missing}/save`).send({})).status).toBe(404);
    state.quote = ok.body;
  });

  t('견적서 헤더 수정, 확정 후 잠금, 새 버전', async () => {
    const id = state.quote.id;
    const patched = await http.patch(`/api/quotes/${id}`).send({ status: 'REVIEW', memo: '검토 요청', periodEnd: '2026-11-30' });
    expect(patched.status).toBe(200);
    expect(patched.body).toEqual(expect.objectContaining({ status: 'REVIEW', memo: '검토 요청', days: 28 }));
    // 항목 기간은 자동 변경되지 않는다
    expect(patched.body.items[0].days).toBe(19);

    expect((await http.patch(`/api/quotes/${id}`).send({ periodStart: '2026-12-01' })).status).toBe(400);
    expect((await http.patch(`/api/quotes/${id}`).send({ status: 'NOPE' })).status).toBe(400);

    expect((await http.patch(`/api/quotes/${id}`).send({ status: 'CONFIRMED' })).status).toBe(200);
    expect((await http.patch(`/api/quotes/${id}`).send({ memo: 'x' })).status).toBe(409);
    expect((await http.post(`/api/quotes/${id}/items`).send({ label: '미정', quantity: 1 })).status).toBe(409);
    expect((await http.post(`/api/quotes/${id}/save`).send({ items: { add: [{ label: '미정', quantity: 1 }] } })).status).toBe(409);
    expect((await http.post(`/api/quotes/${id}/save`).send({ header: { memo: 'x' } })).status).toBe(409);

    const rev = await http.post(`/api/quotes/${id}/revisions`);
    expect(rev.status).toBe(201);
    expect(rev.body).toEqual(expect.objectContaining({ quoteNo: state.quote.quoteNo, version: 2, status: 'DRAFT', memo: '검토 요청' }));
    expect(rev.body.items).toHaveLength(state.quote.items.length);
    expect(rev.body.items[0].id).not.toBe(state.quote.items[0].id);
    expect(rev.body.totalAmount).toBe(state.quote.totalAmount);
    state.rev = rev.body;
    expect(rev.body.isLatest).toBe(true);
    expect((await http.get(`/api/quotes/${id}`)).body.isLatest).toBe(false);

    // 이전 버전은 읽기 전용, 최신이 아닌 것에 revisions 는 409
    expect((await http.post(`/api/quotes/${id}/revisions`)).status).toBe(409);
    expect((await http.patch(`/api/quotes/${id}`).send({ status: 'DRAFT' })).status).toBe(409);

    // 새 버전은 편집 가능
    const edit = await http.post(`/api/quotes/${rev.body.id}/items`).send({ label: '추가 미정', quantity: 1 });
    expect(edit.status).toBe(201);
    expect(edit.body.items).toHaveLength(state.quote.items.length + 1);
  });

  t('견적서 목록: 이전 버전 포함 + isLatest, 필터', async () => {
    const list = await http.get(`/api/quotes?scriptId=${state.scriptId}`);
    expect(list.body.total).toBe(2);
    expect(list.body.items.map((q: any) => [q.version, q.isLatest])).toEqual([[2, true], [1, false]]);
    expect(list.body.items[0]).toEqual(expect.objectContaining({ itemCount: state.quote.items.length + 1, title: '서울의 밤' }));
    expect(list.body.items[0]).not.toHaveProperty('items');

    expect((await http.get('/api/quotes?status=CONFIRMED')).body.total).toBe(1);
    expect((await http.get(`/api/quotes?q=${encodeURIComponent('한빛')}`)).body.total).toBe(2);
    expect((await http.get(`/api/quotes?q=${state.quote.quoteNo}`)).body.total).toBe(2);
    expect((await http.get(`/api/quotes?q=%25`)).body.total).toBe(0); // LIKE 와일드카드 이스케이프
  });

  t('대본 삭제: 원본/파생 데이터 삭제, 견적서는 유지(scriptId null)', async () => {
    const del = await http.delete(`/api/scripts/${state.scriptId}`);
    expect(del.status).toBe(204);
    expect(readdirSync(storageDir)).toHaveLength(0);
    expect((await http.get(`/api/scripts/${state.scriptId}`)).status).toBe(404);

    const q = await http.get(`/api/quotes/${state.rev.id}`);
    expect(q.status).toBe(200);
    expect(q.body.scriptId).toBeNull();
    expect(q.body.title).toBe('서울의 밤');
    expect(q.body.items.some((i: any) => i.requirementId === null)).toBe(true);
    expect(q.body.items.every((i: any) => i.requirementId === null)).toBe(true); // requirement 가 SET NULL

    // 분석 전 상태에서의 견적서 생성은 409 (ANALYZED 아님)
    const up = await upload('S#1. a / 낮\n[SLOW]', {}, 'slow2.txt');
    expect((await http.post('/api/quotes').send({ scriptId: up.body.id })).status).toBe(409);
    await waitStatus(up.body.id, ['ANALYZED']);
    expect(existsSync(storageDir)).toBe(true);
  });
});
