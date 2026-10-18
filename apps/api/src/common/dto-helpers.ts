import { ValidateIf } from 'class-validator';

/** PATCH 용: 생략(undefined)은 허용, null 은 허용하지 않음 (NOT NULL 컬럼). */
export const OptionalNotNull = () => ValidateIf((_o, v) => v !== undefined);
