import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role, TimeOfDay, Usage, VehicleCategory, values } from '../common/enums';
import { isIsoDate } from '../common/date';
import type { AppConfig } from '../config/app.config';
import type {
  EmbedKind,
  LlmAnalyzeRequest,
  LlmAnalyzeResponse,
  LlmEmbedResponse,
  LlmMatchRequirement,
  LlmMatchResponse,
  LlmScene,
  LlmVehicle,
} from './llm.types';

/** multilingual-e5-small 임베딩 차원. vehicles.embedding vector(384) 와 같아야 한다. */
export const EMBEDDING_DIM = 384;

/** 사용자에게 보여 줄 수 있는 메시지를 담은 오류 (script.errorMessage 로 저장됨). */
export class LlmClientError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

const bad = (what: string): never => {
  throw new LlmClientError(`LLM 서버 응답 형식이 올바르지 않습니다 (${what}).`);
};

/** LLM 응답을 계약대로 검증/정규화. 어긋나면 LlmClientError. */
export function parseAnalyzeResponse(raw: unknown): LlmAnalyzeResponse {
  if (!isObj(raw) || !Array.isArray(raw.scenes)) return bad('scenes');
  const seen = new Set<number>();
  const scenes: LlmScene[] = raw.scenes.map((s: unknown, i: number) => {
    if (!isObj(s)) return bad(`scenes[${i}]`);
    const sceneNo = s.sceneNo;
    if (typeof sceneNo !== 'number' || !Number.isInteger(sceneNo) || sceneNo < 0) return bad(`scenes[${i}].sceneNo`);
    if (seen.has(sceneNo)) return bad(`씬 번호 ${sceneNo} 중복`);
    seen.add(sceneNo);
    const timeOfDay = values(TimeOfDay).includes(s.timeOfDay as TimeOfDay) ? (s.timeOfDay as TimeOfDay) : TimeOfDay.UNKNOWN;
    const vehiclesRaw = s.vehicles ?? [];
    if (!Array.isArray(vehiclesRaw)) return bad(`scenes[${i}].vehicles`);
    const vehicles: LlmVehicle[] = vehiclesRaw.map((v: unknown, j: number) => {
      if (!isObj(v)) return bad(`scenes[${i}].vehicles[${j}]`);
      if (!values(Role).includes(v.role as Role)) return bad(`vehicles[${j}].role`);
      if (!values(Usage).includes(v.usage as Usage)) return bad(`vehicles[${j}].usage`);
      if (typeof v.vehicleType !== 'string' || !v.vehicleType.trim()) return bad(`vehicles[${j}].vehicleType`);
      const quantity = typeof v.quantity === 'number' && Number.isInteger(v.quantity) && v.quantity >= 1 ? v.quantity : 1;
      const confidence =
        typeof v.confidence === 'number' && v.confidence >= 0 && v.confidence <= 1 ? v.confidence : null;
      const category = values(VehicleCategory).includes(v.categoryHint as VehicleCategory)
        ? (v.categoryHint as VehicleCategory)
        : null;
      return {
        role: v.role as Role,
        vehicleType: v.vehicleType.trim().slice(0, 100),
        categoryHint: category,
        brandModelHint: strOrNull(v.brandModelHint)?.slice(0, 100) ?? null,
        quantity,
        usage: v.usage as Usage,
        damageExpected: v.damageExpected === true,
        sourceQuote: strOrNull(v.sourceQuote),
        confidence,
      };
    });
    return {
      sceneNo,
      location: strOrNull(s.location)?.slice(0, 200) ?? null,
      timeOfDay,
      summary: typeof s.summary === 'string' ? s.summary : '',
      sourceText: typeof s.sourceText === 'string' ? s.sourceText : '',
      shootDateHint: isIsoDate(s.shootDateHint) ? s.shootDateHint : null,
      vehicles,
    };
  });

  const sched = isObj(raw.shootSchedule) ? raw.shootSchedule : {};
  return {
    scriptId: typeof raw.scriptId === 'string' ? raw.scriptId : '',
    model: typeof raw.model === 'string' && raw.model ? raw.model.slice(0, 100) : 'unknown',
    promptVersion: typeof raw.promptVersion === 'string' && raw.promptVersion ? raw.promptVersion.slice(0, 50) : 'unknown',
    scenes,
    shootSchedule: {
      start: isIsoDate(sched.start) ? sched.start : null,
      end: isIsoDate(sched.end) ? sched.end : null,
      hints: Array.isArray(sched.hints) ? sched.hints.filter((h): h is string => typeof h === 'string') : [],
    },
  };
}

export function parseEmbedResponse(raw: unknown, expected: number): LlmEmbedResponse {
  if (!isObj(raw) || typeof raw.model !== 'string' || !raw.model || !Array.isArray(raw.embeddings)) return bad('embed');
  const embeddings = raw.embeddings;
  if (embeddings.length !== expected) return bad('embeddings 개수');
  for (const e of embeddings) {
    if (!Array.isArray(e) || e.length !== EMBEDDING_DIM || !e.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return bad(`embedding 차원(${EMBEDDING_DIM} 필요)`);
    }
  }
  return { model: raw.model.slice(0, 100), dimension: EMBEDDING_DIM, embeddings: embeddings as number[][] };
}

export function parseMatchResponse(raw: unknown): LlmMatchResponse {
  if (!isObj(raw) || !Array.isArray(raw.candidates)) return bad('candidates');
  const candidates = raw.candidates.flatMap((c: unknown) => {
    if (!isObj(c) || typeof c.vehicleId !== 'string' || typeof c.score !== 'number' || !Number.isFinite(c.score)) return [];
    return [
      {
        vehicleId: c.vehicleId,
        score: Math.max(0, Math.min(100, Math.round(c.score))),
        reason: typeof c.reason === 'string' ? c.reason : '',
      },
    ];
  });
  return { model: typeof raw.model === 'string' ? raw.model : 'unknown', candidates };
}

@Injectable()
export class LlmClient {
  private readonly logger = new Logger(LlmClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly embedTimeoutMs: number;
  private readonly matchTimeoutMs: number;

  constructor(config: ConfigService<AppConfig, true>) {
    this.baseUrl = config.get('llmServerUrl', { infer: true });
    this.timeoutMs = config.get('llmTimeoutMs', { infer: true });
    this.embedTimeoutMs = config.get('llmEmbedTimeoutMs', { infer: true }) ?? 30_000;
    this.matchTimeoutMs = config.get('llmMatchTimeoutMs', { infer: true }) ?? 15_000;
  }

  /** 차량 설명(passage) 또는 질의(query)를 임베딩. 실패하면 LlmClientError. */
  async embed(texts: string[], kind: EmbedKind): Promise<LlmEmbedResponse> {
    const json = await this.postJson('/embed', { texts, kind }, this.embedTimeoutMs, '임베딩');
    return parseEmbedResponse(json, texts.length);
  }

  /** 요구사항 → 보유 차량 후보 (LLM 서버가 pgvector 로 직접 검색). 실패하면 LlmClientError. */
  async match(requirement: LlmMatchRequirement, topK = 5): Promise<LlmMatchResponse> {
    const json = await this.postJson('/match', { requirement, topK }, this.matchTimeoutMs, '후보 매칭');
    return parseMatchResponse(json);
  }

  private async postJson(path: string, body: unknown, timeoutMs: number, label: string): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new LlmClientError(`${label} 시간이 초과되었습니다 (${Math.round(timeoutMs / 1000)}초).`);
      }
      throw new LlmClientError('LLM 서버에 연결할 수 없습니다.');
    }
    if (!res.ok) throw new LlmClientError(`LLM 서버 오류 (HTTP ${res.status}).`);
    try {
      return await res.json();
    } catch {
      return bad('JSON 아님');
    }
  }

  async analyze(body: LlmAnalyzeRequest): Promise<LlmAnalyzeResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === 'TimeoutError' || err.name === 'AbortError') {
        throw new LlmClientError(`분석 시간이 초과되었습니다 (${Math.round(this.timeoutMs / 1000)}초).`);
      }
      this.logger.warn(`LLM 서버 연결 실패: ${err.message}`);
      throw new LlmClientError('LLM 서버에 연결할 수 없습니다.');
    }

    if (!res.ok) {
      // 응답 본문(detail)에 대본 내용이 섞일 수 있어 상태 코드만 남긴다.
      this.logger.warn(`LLM 서버 오류 응답: HTTP ${res.status}`);
      throw new LlmClientError(`LLM 서버 오류 (HTTP ${res.status}).`);
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return bad('JSON 아님');
    }
    return parseAnalyzeResponse(json);
  }
}
