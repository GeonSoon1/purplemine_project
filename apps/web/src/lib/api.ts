// 백엔드 호출은 전부 이 파일에서만 한다. 엔드포인트는 docs/api/ 기준.
// 브라우저는 같은 출처의 /api 로 부르고, next.config.ts 의 rewrites 가 백엔드로 넘긴다.
import type {
  Analysis,
  Page,
  Quote,
  QuoteListItem,
  QuoteStatus,
  Requirement,
  Role,
  Script,
  ScriptStatus,
  Usage,
  Vehicle,
  VehicleCategory,
  VehicleSummary,
} from './types';

const BASE = '/api';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ErrorBody {
  message?: string | string[];
  error?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { cache: 'no-store', ...init });
  } catch {
    throw new ApiError(0, '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  if (!res.ok) {
    let message = `요청에 실패했습니다 (${res.status})`;
    try {
      const body = (await res.json()) as ErrorBody;
      if (Array.isArray(body.message)) message = body.message.join('\n');
      else if (body.message) message = body.message;
    } catch {
      /* 본문이 JSON이 아니면 기본 문구 */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// ── 대본 ──
export const scripts = {
  list: (p: { status?: ScriptStatus; q?: string; page?: number; pageSize?: number } = {}) =>
    request<Page<Script>>(`/scripts${qs(p)}`),
  get: (id: string) => request<Script>(`/scripts/${id}`),
  upload: (form: FormData) => request<Script>('/scripts', { method: 'POST', body: form }),
  remove: (id: string) => request<void>(`/scripts/${id}`, { method: 'DELETE' }),
  reanalyze: (id: string) => request<Script>(`/scripts/${id}/analyze`, { method: 'POST' }),
};

// ── 분석 결과 · 요구사항 · 매칭 ──
export interface RequirementInput {
  role: Role;
  vehicleType: string;
  categoryHint: VehicleCategory | null;
  brandModelHint: string | null;
  quantity: number;
  usage: Usage;
  damageExpected: boolean;
  sourceQuote: string | null;
}

export const analysis = {
  get: (scriptId: string) => request<Analysis>(`/scripts/${scriptId}/analysis`),
  addRequirement: (scriptId: string, body: Partial<RequirementInput> & { sceneId: string }) =>
    request<Requirement>(`/scripts/${scriptId}/requirements`, json('POST', body)),
  updateRequirement: (id: string, body: Partial<RequirementInput>) =>
    request<Requirement>(`/requirements/${id}`, json('PATCH', body)),
  removeRequirement: (id: string) => request<void>(`/requirements/${id}`, { method: 'DELETE' }),
  rematch: (id: string) => request<Requirement>(`/requirements/${id}/rematch`, { method: 'POST' }),
  select: (id: string, vehicleIds: string[]) =>
    request<Requirement>(`/requirements/${id}/selection`, json('PUT', { vehicleIds })),
};

// ── 차량 ──
export const vehicles = {
  list: (
    p: {
      q?: string;
      category?: VehicleCategory;
      damageAllowed?: boolean;
      status?: string;
      page?: number;
      pageSize?: number;
    } = {},
  ) => request<Page<Vehicle>>(`/vehicles${qs(p)}`),
  summary: () => request<VehicleSummary>('/vehicles/summary'),
};

// ── 견적서 ──
export interface QuoteHeaderPatch {
  status?: QuoteStatus;
  periodStart?: string | null;
  periodEnd?: string | null;
  validUntil?: string | null;
  author?: string | null;
  memo?: string | null;
}

export interface QuoteItemPatch {
  vehicleId?: string | null;
  label?: string | null;
  role?: Role | null;
  usage?: Usage | null;
  quantity?: number;
  startDate?: string | null;
  endDate?: string | null;
  unitPrice?: number;
  extraAmount?: number;
  memo?: string | null;
  sceneNos?: number[];
}

export interface QuoteSaveBody {
  header?: QuoteHeaderPatch;
  items?: {
    add?: QuoteItemPatch[];
    update?: (QuoteItemPatch & { id: string })[];
    remove?: string[];
  };
}

export const quotes = {
  create: (body: { scriptId: string; author?: string; validUntil?: string }) =>
    request<Quote>('/quotes', json('POST', body)),
  list: (
    p: { status?: QuoteStatus; scriptId?: string; q?: string; page?: number; pageSize?: number } = {},
  ) => request<Page<QuoteListItem>>(`/quotes${qs(p)}`),
  get: (id: string) => request<Quote>(`/quotes/${id}`),
  update: (id: string, body: QuoteHeaderPatch) => request<Quote>(`/quotes/${id}`, json('PATCH', body)),
  addItem: (id: string, body: QuoteItemPatch) =>
    request<Quote>(`/quotes/${id}/items`, json('POST', body)),
  updateItem: (id: string, itemId: string, body: QuoteItemPatch) =>
    request<Quote>(`/quotes/${id}/items/${itemId}`, json('PATCH', body)),
  removeItem: (id: string, itemId: string) =>
    request<Quote>(`/quotes/${id}/items/${itemId}`, { method: 'DELETE' }),
  /** 헤더 + 항목 추가/수정/삭제 일괄 저장. 전부 반영되거나 전부 반영되지 않는다. */
  save: (id: string, body: QuoteSaveBody) => request<Quote>(`/quotes/${id}/save`, json('POST', body)),
  revise: (id: string) => request<Quote>(`/quotes/${id}/revisions`, { method: 'POST' }),
};
