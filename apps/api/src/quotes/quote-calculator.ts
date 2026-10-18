import { inclusiveDays } from '../common/date';

/** 부가세율 (10% 별도 고정. 포함/별도 선택은 요구사항 Q6 결정 후 확장). */
export const TAX_RATE_PERCENT = 10;

export const itemDays = (start: string | null, end: string | null): number | null => inclusiveDays(start, end);

/** 소계 = 단가 × 수량 × 일수 + 추가 비용. 기간이 없으면(일수 null) 추가 비용만. */
export const itemSubtotal = (unitPrice: number, quantity: number, days: number | null, extraAmount: number): number =>
  days === null ? extraAmount : unitPrice * quantity * days + extraAmount;

/** 공급가액 = 소계 합, 부가세 = floor(공급가액 × 10%), 합계 = 공급가액 + 부가세. 전부 원 단위 정수. */
export const calcTotals = (subtotals: number[]) => {
  const supplyAmount = subtotals.reduce((sum, n) => sum + n, 0);
  const taxAmount = Math.floor((supplyAmount * TAX_RATE_PERCENT) / 100);
  return { supplyAmount, taxAmount, totalAmount: supplyAmount + taxAmount };
};
