import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { mapLimit } from '../common/concurrency';
import { VehicleStatus } from '../common/enums';
import type { AppConfig } from '../config/app.config';
import { Vehicle } from '../entities';
import { LlmClient } from '../llm/llm.client';
import { MAX_CANDIDATES, MatchableRequirement, MatchableVehicle, MatchResult, rankCandidates } from './matching';

export type MatchSource = 'rag' | 'rule';
export interface MatchOutcome {
  source: MatchSource;
  results: MatchResult[];
}
export type MatchRequest = MatchableRequirement & { quantity?: number };

export const MATCH_CONCURRENCY = 5;

/**
 * 후보 산정 진입점. MATCH_MODE=rag(기본)면 LLM 서버 /match 를 먼저 호출하고,
 * 실패(타임아웃·5xx·연결 불가)하거나 결과가 비면 규칙 기반으로 폴백한다.
 * 외부 HTTP 를 쓰므로 DB 트랜잭션 밖에서 호출해야 한다.
 */
@Injectable()
export class CandidateMatcher {
  private readonly logger = new Logger(CandidateMatcher.name);
  private readonly mode: 'rag' | 'rule';

  constructor(
    @InjectRepository(Vehicle) private readonly vehicles: Repository<Vehicle>,
    private readonly llm: LlmClient,
    config: ConfigService<AppConfig, true>,
  ) {
    this.mode = config.get('matchMode', { infer: true }) ?? 'rag';
  }

  async match(req: MatchRequest, ruleVehicles?: () => Promise<MatchableVehicle[]>): Promise<MatchOutcome> {
    const outcome = await this.matchOne(req, ruleVehicles ?? (() => this.loadAvailable()));
    this.logger.log(`후보 산정: ${outcome.source} (${outcome.results.length}건)`);
    return outcome;
  }

  /** 요구사항이 많을 때 /match 동시 호출을 제한. 규칙 폴백용 차량 목록은 한 번만 읽는다. 입력 순서대로 반환. */
  async matchMany(reqs: readonly MatchRequest[]): Promise<MatchOutcome[]> {
    let cache: Promise<MatchableVehicle[]> | undefined;
    const lazyVehicles = () => (cache ??= this.loadAvailable());
    const outcomes = await mapLimit(reqs, MATCH_CONCURRENCY, (r) => this.matchOne(r, lazyVehicles));
    const rag = outcomes.filter((o) => o.source === 'rag').length;
    this.logger.log(`후보 산정 ${reqs.length}건: rag ${rag}, rule ${outcomes.length - rag}`);
    return outcomes;
  }

  private async matchOne(req: MatchRequest, ruleVehicles: () => Promise<MatchableVehicle[]>): Promise<MatchOutcome> {
    if (this.mode === 'rag') {
      const rag = await this.tryRag(req);
      if (rag.length) return { source: 'rag', results: rag };
    }
    return { source: 'rule', results: rankCandidates(req, await ruleVehicles()) };
  }

  private async tryRag(req: MatchRequest): Promise<MatchResult[]> {
    try {
      const res = await this.llm.match(
        {
          vehicleType: req.vehicleType,
          categoryHint: req.categoryHint,
          brandModelHint: req.brandModelHint,
          usage: req.usage,
          damageExpected: req.damageExpected,
          quantity: req.quantity ?? 1,
          sourceQuote: req.sourceQuote,
        },
        MAX_CANDIDATES,
      );
      if (!res.candidates.length) {
        this.logger.warn('LLM /match 결과가 비어 규칙 기반으로 폴백합니다.');
        return [];
      }
      // 중복 제거, 점수 내림차순(동률은 LLM 응답 순서 유지)
      const seen = new Set<string>();
      const sorted = res.candidates
        .filter((c) => !seen.has(c.vehicleId) && seen.add(c.vehicleId))
        .map((c, i) => ({ c, i }))
        .sort((a, b) => b.c.score - a.c.score || a.i - b.i)
        .map((x) => x.c);
      // LLM 서버는 읽기 전용으로 직접 검색하므로 우리 쪽에서 존재/가용 여부를 다시 확인한다.
      const ids = sorted.map((c) => c.vehicleId).filter((id) => UUID_RE.test(id));
      const live = ids.length
        ? new Set(
            (await this.vehicles.find({ where: { id: In(ids), status: VehicleStatus.AVAILABLE }, select: { id: true } })).map(
              (v) => v.id,
            ),
          )
        : new Set<string>();
      const kept = sorted.filter((c) => live.has(c.vehicleId)).slice(0, MAX_CANDIDATES);
      if (!kept.length) this.logger.warn('LLM /match 후보가 모두 존재하지 않거나 가용 상태가 아니라 규칙 기반으로 폴백합니다.');
      return kept.map((c, i) => ({ vehicleId: c.vehicleId, score: c.score, reason: c.reason || 'RAG 유사도 매칭', rank: i + 1 }));
    } catch (e) {
      this.logger.warn(`LLM /match 실패, 규칙 기반으로 폴백합니다: ${(e as Error).message}`);
      return [];
    }
  }

  private loadAvailable(): Promise<Vehicle[]> {
    return this.vehicles.findBy({ status: VehicleStatus.AVAILABLE });
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
