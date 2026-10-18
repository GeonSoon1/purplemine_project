import { Transform, Type } from 'class-transformer';
import { IsInt, Max, Min, IsOptional } from 'class-validator';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 20;
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export const toPage = <T>(items: T[], q: { page: number; pageSize: number }, total: number): Page<T> => ({
  items,
  page: q.page,
  pageSize: q.pageSize,
  total,
});

export const skipOf = (q: { page: number; pageSize: number }): number => (q.page - 1) * q.pageSize;

/** 'true' / 'false' 쿼리 문자열을 boolean 으로. */
export const ToBoolean = () =>
  Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : value));

/** LIKE 패턴 이스케이프. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
