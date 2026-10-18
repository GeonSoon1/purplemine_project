import type { Role, TimeOfDay, Usage, VehicleCategory } from '../common/enums';

/** docs/api/llm.md 의 POST /analyze 계약. */
export interface LlmAnalyzeRequest {
  scriptId: string;
  text: string;
  hints: { shootStart: string | null; shootEnd: string | null } | null;
}

export interface LlmVehicle {
  role: Role;
  vehicleType: string;
  categoryHint: VehicleCategory | null;
  brandModelHint: string | null;
  quantity: number;
  usage: Usage;
  damageExpected: boolean;
  sourceQuote: string | null;
  confidence: number | null;
}

export interface LlmScene {
  sceneNo: number;
  location: string | null;
  timeOfDay: TimeOfDay;
  summary: string;
  sourceText: string;
  shootDateHint: string | null;
  vehicles: LlmVehicle[];
}

export interface LlmAnalyzeResponse {
  scriptId: string;
  model: string;
  promptVersion: string;
  scenes: LlmScene[];
  shootSchedule: { start: string | null; end: string | null; hints: string[] };
}

/** POST /embed 계약. 384차원(multilingual-e5-small). */
export type EmbedKind = 'passage' | 'query';
export interface LlmEmbedResponse {
  model: string;
  dimension: number;
  embeddings: number[][];
}

/** POST /match 요청의 requirement. */
export interface LlmMatchRequirement {
  vehicleType: string;
  categoryHint: VehicleCategory | null;
  brandModelHint: string | null;
  usage: Usage;
  damageExpected: boolean;
  quantity: number;
  sourceQuote: string | null;
}
export interface LlmMatchCandidate {
  vehicleId: string;
  score: number;
  reason: string;
}
export interface LlmMatchResponse {
  model: string;
  candidates: LlmMatchCandidate[];
}
