import { resolve } from 'node:path';

/** 환경변수 해석. ConfigModule 대신 순수 함수로 두어 테스트/CLI 에서도 재사용. */
export const appConfig = () => ({
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),
  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://purplemine:purplemine@localhost:5433/purplemine',
  migrationsRun: process.env.DB_MIGRATIONS_RUN === 'true',
  scriptStorageDir: resolve(process.cwd(), process.env.SCRIPT_STORAGE_DIR ?? '../../data/scripts'),
  llmServerUrl: (process.env.LLM_SERVER_URL ?? 'http://localhost:8000').replace(/\/+$/, ''),
  llmTimeoutMs: Number(process.env.LLM_TIMEOUT_MS ?? 120_000),
  /** /embed, /match 는 요청 경로에서 불리므로 분석보다 짧은 타임아웃을 쓴다. */
  llmEmbedTimeoutMs: Number(process.env.LLM_EMBED_TIMEOUT_MS ?? 30_000),
  llmMatchTimeoutMs: Number(process.env.LLM_MATCH_TIMEOUT_MS ?? 15_000),
  /** rag: LLM /match 우선, 실패/빈 결과면 규칙 기반 폴백. rule: 규칙 기반만. */
  matchMode: (process.env.MATCH_MODE === 'rule' ? 'rule' : 'rag') as 'rag' | 'rule',
});

export type AppConfig = ReturnType<typeof appConfig>;
