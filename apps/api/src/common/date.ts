import { registerDecorator, ValidationOptions } from 'class-validator';
import { Transform } from 'class-transformer';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** YYYY-MM-DD 실존 날짜인지 검증. */
export function IsIsoDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isIsoDate',
      target: target.constructor,
      propertyName,
      options: { message: `${propertyName} must be a date in YYYY-MM-DD format`, ...options },
      validator: { validate: isIsoDate },
    });
}

/** multipart 에서 빈 문자열로 오는 값을 undefined 로. */
export const EmptyToUndefined = () => Transform(({ value }) => (value === '' ? undefined : value));

const DAY_MS = 86_400_000;

/** 양 끝 포함 일수. end < start 면 null. */
export const inclusiveDays = (start: string | null, end: string | null): number | null => {
  if (!start || !end) return null;
  const diff = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS;
  return diff < 0 ? null : diff + 1;
};

export const addDays = (date: string | Date, days: number): string => {
  const base = typeof date === 'string' ? Date.parse(`${date}T00:00:00Z`) : date.getTime();
  return new Date(base + days * DAY_MS).toISOString().slice(0, 10);
};

export const todayUtc = (): string => new Date().toISOString().slice(0, 10);
