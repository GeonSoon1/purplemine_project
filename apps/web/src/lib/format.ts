import type {
  QuoteStatus,
  Role,
  ScriptStatus,
  TimeOfDay,
  Usage,
  VehicleCategory,
} from './types';

export const won = (n: number) => n.toLocaleString('ko-KR');

/** 2026-11-03 → 2026.11.03 */
export const fmtDate = (d: string | null | undefined) => (d ? d.slice(0, 10).replaceAll('-', '.') : '-');

export function fmtPeriod(start: string | null, end: string | null, days?: number | null) {
  if (!start && !end) return '-';
  const base = `${fmtDate(start)} ~ ${fmtDate(end)}`;
  return days ? `${base} (${days}일)` : base;
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export const ROLE_LABEL: Record<Role, string> = { LEAD: '주인공', SUPPORT: '조연', BACKGROUND: '배경' };
export const USAGE_LABEL: Record<Usage, string> = {
  NORMAL: '일반 주행',
  CHASE: '추격',
  ACTION: '액션',
  DAMAGE: '파손',
};
export const TIME_LABEL: Record<TimeOfDay, string> = {
  DAY: '낮',
  NIGHT: '밤',
  DAWN: '새벽',
  DUSK: '저녁',
  UNKNOWN: '',
};
export const CATEGORY_LABEL: Record<VehicleCategory, string> = {
  COMPACT: '경차',
  SEDAN: '세단',
  SUV: 'SUV',
  VAN: '승합',
  TRUCK: '트럭',
  SPORTS: '스포츠카',
  CLASSIC: '클래식',
  OTHER: '기타',
};
export const SCRIPT_STATUS_LABEL: Record<ScriptStatus, string> = {
  UPLOADED: '대기',
  ANALYZING: '분석 중',
  ANALYZED: '분석 완료',
  FAILED: '분석 실패',
};
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: '초안',
  REVIEW: '검토중',
  SENT: '발송',
  CONFIRMED: '확정',
};
export const QUOTE_STATUS_ORDER: QuoteStatus[] = ['DRAFT', 'REVIEW', 'SENT', 'CONFIRMED'];

export const ROLES: Role[] = ['LEAD', 'SUPPORT', 'BACKGROUND'];
export const USAGES: Usage[] = ['NORMAL', 'CHASE', 'ACTION', 'DAMAGE'];
export const CATEGORIES: VehicleCategory[] = [
  'COMPACT',
  'SEDAN',
  'SUV',
  'VAN',
  'TRUCK',
  'SPORTS',
  'CLASSIC',
  'OTHER',
];

/** 신뢰도 3단계 (design-system 5.8, 기준값 0.8 / 0.5는 임시) */
export type ConfidenceLevel = 'high' | 'check' | 'low';
export function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.8) return 'high';
  if (c >= 0.5) return 'check';
  return 'low';
}

export function vehicleName(v: { brand: string; model: string; year: number; color: string | null }) {
  return [`${v.brand} ${v.model}`, v.year, v.color].filter(Boolean).join(' ');
}

const DAY_MS = 86_400_000;
const toUtc = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));

/** 양 끝 포함 일수 (견적서 계산 규칙과 같음) */
export function daysBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  return Math.round((toUtc(end) - toUtc(start)) / DAY_MS) + 1;
}

/** start 부터 days 일째 되는 날 (YYYY-MM-DD) */
export function endFromDays(start: string, days: number): string {
  return new Date(toUtc(start) + (days - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** 2026.11.03 ~ 11.07 (같은 해면 뒤쪽 연도 생략) */
export function fmtShortPeriod(start: string | null, end: string | null) {
  if (!start || !end) return null;
  const e = start.slice(0, 4) === end.slice(0, 4) ? end.slice(5).replace('-', '.') : fmtDate(end);
  return `${fmtDate(start)} ~ ${e}`;
}
