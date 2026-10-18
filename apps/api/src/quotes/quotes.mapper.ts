import { inclusiveDays } from '../common/date';
import type { Quote, QuoteItem } from '../entities';

export const toItemDto = (i: QuoteItem) => ({
  id: i.id,
  vehicleId: i.vehicleId,
  requirementId: i.requirementId,
  vehicle: i.vehicle
    ? {
        plateNo: i.vehicle.plateNo,
        brand: i.vehicle.brand,
        model: i.vehicle.model,
        year: i.vehicle.year,
        color: i.vehicle.color,
        category: i.vehicle.category,
      }
    : null,
  label: i.label,
  role: i.role,
  usage: i.usage,
  damageExpected: i.damageExpected,
  sceneNos: i.sceneNos ?? [],
  quantity: i.quantity,
  startDate: i.startDate,
  endDate: i.endDate,
  days: i.days,
  unitPrice: i.unitPrice,
  extraAmount: i.extraAmount,
  subtotal: i.subtotal,
  memo: i.memo,
});

const header = (q: Quote) => ({
  id: q.id,
  quoteNo: q.quoteNo,
  version: q.version,
  status: q.status,
  scriptId: q.scriptId,
  title: q.title,
  productionCompany: q.productionCompany,
});

export const toQuoteDto = (q: Quote, items: QuoteItem[], isLatest: boolean) => ({
  ...header(q),
  isLatest,
  periodStart: q.periodStart,
  periodEnd: q.periodEnd,
  days: inclusiveDays(q.periodStart, q.periodEnd),
  author: q.author,
  validUntil: q.validUntil,
  memo: q.memo,
  supplyAmount: q.supplyAmount,
  taxAmount: q.taxAmount,
  totalAmount: q.totalAmount,
  unassignedCount: items.filter((i) => i.vehicleId === null).length,
  items: items.map(toItemDto),
  createdAt: q.createdAt,
  updatedAt: q.updatedAt,
});

export const toQuoteListItemDto = (
  q: Quote,
  extra: { isLatest: boolean; itemCount: number; unassignedCount: number },
) => ({
  ...header(q),
  isLatest: extra.isLatest,
  periodStart: q.periodStart,
  periodEnd: q.periodEnd,
  totalAmount: q.totalAmount,
  itemCount: extra.itemCount,
  unassignedCount: extra.unassignedCount,
  author: q.author,
  createdAt: q.createdAt,
});
