import { calcTotals, itemDays, itemSubtotal } from './quote-calculator';

describe('quote-calculator', () => {
  it('일수는 양 끝 포함', () => {
    expect(itemDays('2026-11-03', '2026-11-03')).toBe(1);
    expect(itemDays('2026-11-03', '2026-11-07')).toBe(5);
    expect(itemDays('2026-11-03', '2026-11-21')).toBe(19);
    expect(itemDays('2026-02-27', '2026-03-02')).toBe(4);
  });
  it('기간이 없거나 역전이면 null', () => {
    expect(itemDays(null, '2026-11-03')).toBeNull();
    expect(itemDays('2026-11-03', null)).toBeNull();
    expect(itemDays('2026-11-05', '2026-11-03')).toBeNull();
  });
  it('소계 = 단가 × 수량 × 일수 + 추가 비용 (명세 예시)', () => {
    expect(itemSubtotal(220000, 1, 5, 50000)).toBe(1_150_000);
    expect(itemSubtotal(95000, 2, 3, 50000)).toBe(620_000);
  });
  it('기간이 없으면 추가 비용만', () => {
    expect(itemSubtotal(220000, 3, null, 30000)).toBe(30000);
  });
  it('합계: 공급가액, floor(10%), 합계 (명세 예시)', () => {
    expect(calcTotals([1_150_000])).toEqual({
      supplyAmount: 1_150_000,
      taxAmount: 115_000,
      totalAmount: 1_265_000,
    });
  });
  it('부가세는 내림', () => {
    expect(calcTotals([10_009])).toEqual({
      supplyAmount: 10_009,
      taxAmount: 1_000,
      totalAmount: 11_009,
    });
    expect(calcTotals([])).toEqual({
      supplyAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
    });
  });
});
