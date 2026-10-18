export const ScriptStatus = {
  UPLOADED: 'UPLOADED',
  ANALYZING: 'ANALYZING',
  ANALYZED: 'ANALYZED',
  FAILED: 'FAILED',
} as const;
export type ScriptStatus = (typeof ScriptStatus)[keyof typeof ScriptStatus];

export const TimeOfDay = {
  DAY: 'DAY',
  NIGHT: 'NIGHT',
  DAWN: 'DAWN',
  DUSK: 'DUSK',
  UNKNOWN: 'UNKNOWN',
} as const;
export type TimeOfDay = (typeof TimeOfDay)[keyof typeof TimeOfDay];

export const Role = { LEAD: 'LEAD', SUPPORT: 'SUPPORT', BACKGROUND: 'BACKGROUND' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const Usage = { NORMAL: 'NORMAL', CHASE: 'CHASE', ACTION: 'ACTION', DAMAGE: 'DAMAGE' } as const;
export type Usage = (typeof Usage)[keyof typeof Usage];

export const VehicleCategory = {
  COMPACT: 'COMPACT',
  SEDAN: 'SEDAN',
  SUV: 'SUV',
  VAN: 'VAN',
  TRUCK: 'TRUCK',
  SPORTS: 'SPORTS',
  CLASSIC: 'CLASSIC',
  OTHER: 'OTHER',
} as const;
export type VehicleCategory = (typeof VehicleCategory)[keyof typeof VehicleCategory];

export const VehicleStatus = {
  AVAILABLE: 'AVAILABLE',
  MAINTENANCE: 'MAINTENANCE',
  INACTIVE: 'INACTIVE',
} as const;
export type VehicleStatus = (typeof VehicleStatus)[keyof typeof VehicleStatus];

export const QuoteStatus = {
  DRAFT: 'DRAFT',
  REVIEW: 'REVIEW',
  SENT: 'SENT',
  CONFIRMED: 'CONFIRMED',
} as const;
export type QuoteStatus = (typeof QuoteStatus)[keyof typeof QuoteStatus];

export const values = <T extends Record<string, string>>(e: T): T[keyof T][] =>
  Object.values(e) as T[keyof T][];

/** "직접 선택" 후보의 reason. 재매칭 시 이 값으로 수동 후보를 구분한다. */
export const MANUAL_CANDIDATE_REASON = '직접 선택';
