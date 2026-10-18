import { ValueTransformer } from 'typeorm';

/** pg 는 numeric/bigint 를 문자열로 돌려준다. 금액은 원 단위 정수이므로 number 로 변환. */
export const numericTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value === null || value === undefined ? value : Number(value)),
};
