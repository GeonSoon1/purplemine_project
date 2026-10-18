import { randomUUID } from 'node:crypto';
import { MatchCandidate, Scene, VehicleRequirement } from '../entities';
import type { LlmAnalyzeResponse } from '../llm/llm.types';
import { MatchableVehicle, MatchResult, rankCandidates } from '../matching/matching';

export interface AnalysisRows {
  scenes: Scene[];
  requirements: VehicleRequirement[];
  candidates: MatchCandidate[];
}

/** 요구사항 id → 후보. */
export type CandidatesByRequirement = Map<string, MatchResult[]>;

/** 규칙 기반으로 후보를 계산한 행 (RAG 없이 쓰는 편의 함수). */
export function buildAnalysisRows(scriptId: string, result: LlmAnalyzeResponse, availableVehicles: MatchableVehicle[]): AnalysisRows {
  const rows = buildStructure(scriptId, result);
  const byReq: CandidatesByRequirement = new Map(rows.requirements.map((r) => [r.id, rankCandidates(r, availableVehicles)]));
  rows.candidates = buildCandidates(rows.requirements, byReq);
  return rows;
}

/** 1단계: LLM 분석 결과 → 씬/요구사항 엔티티 (순수 함수, 후보 없음). */
export function buildStructure(scriptId: string, result: LlmAnalyzeResponse): AnalysisRows {
  const rows: AnalysisRows = { scenes: [], requirements: [], candidates: [] };

  for (const s of result.scenes) {
    const scene = Object.assign(new Scene(), {
      id: randomUUID(),
      scriptId,
      sceneNo: s.sceneNo,
      location: s.location,
      timeOfDay: s.timeOfDay,
      summary: s.summary,
      sourceText: s.sourceText,
      shootDateHint: s.shootDateHint,
    });
    rows.scenes.push(scene);

    for (const v of s.vehicles) {
      const req = Object.assign(new VehicleRequirement(), {
        id: randomUUID(),
        sceneId: scene.id,
        role: v.role,
        vehicleType: v.vehicleType,
        categoryHint: v.categoryHint,
        brandModelHint: v.brandModelHint,
        quantity: v.quantity,
        usage: v.usage,
        damageExpected: v.damageExpected,
        sourceQuote: v.sourceQuote,
        confidence: v.confidence,
        isUserEdited: false,
      });
      rows.requirements.push(req);
    }
  }
  return rows;
}

/** 2단계: 요구사항별 후보 → MatchCandidate 엔티티. 자동 선택 없음. */
export function buildCandidates(requirements: VehicleRequirement[], byReq: CandidatesByRequirement): MatchCandidate[] {
  return requirements.flatMap((req) =>
    (byReq.get(req.id) ?? []).map((m) =>
      Object.assign(new MatchCandidate(), {
        id: randomUUID(),
        requirementId: req.id,
        vehicleId: m.vehicleId,
        score: m.score,
        reason: m.reason,
        rank: m.rank,
        isSelected: false,
      }),
    ),
  );
}
