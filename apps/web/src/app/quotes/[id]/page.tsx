'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { quotes } from '@/lib/api';
import type { QuoteHeaderPatch, QuoteSaveBody } from '@/lib/api';
import type { Quote, QuoteItem, QuoteItemVehicle, QuoteStatus, Vehicle } from '@/lib/types';
import {
  QUOTE_STATUS_LABEL,
  QUOTE_STATUS_ORDER,
  daysBetween,
  endFromDays,
  fmtDate,
  fmtPeriod,
  fmtShortPeriod,
  vehicleName,
} from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { Banner, Button, EmptyState, LoadError, Skeletons, won } from '@/components/ui';
import { PlateChip, QuoteStatusBadge, RoleTag, UsageTag } from '@/components/tags';
import { Stepper } from '@/components/Stepper';
import { ConfirmModal } from '@/components/Modal';
import { VehiclePicker } from '@/components/VehiclePicker';
import { useToast } from '@/components/Toast';

type ItemDraft = Partial<Pick<QuoteItem, 'quantity' | 'startDate' | 'endDate' | 'unitPrice' | 'extraAmount' | 'memo' | 'vehicleId'>>;

/** 저장 전에 화면에서만 추가한 항목의 임시 id 접두어 */
const NEW = 'new-';
const isNew = (id: string) => id.startsWith(NEW);

const digits = (v: string) => Number(v.replace(/[^0-9]/g, '')) || 0;

export default function QuoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const fetcher = useCallback(() => quotes.get(id), [id]);
  const { data: quote, error, loading, reload, setData } = useLoad<Quote>(fetcher);

  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({});
  const [headerDraft, setHeaderDraft] = useState<QuoteHeaderPatch>({});
  /** 저장 전에 추가한 항목 (id 는 임시값, 저장 때 add 로 보낸다) */
  const [added, setAdded] = useState<QuoteItem[]>([]);
  /** 저장 전에 삭제 표시한 기존 항목 id */
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  /** 저장 전에 차량을 지정한 항목의 차량 (화면 표시용) */
  const [assigned, setAssigned] = useState<Record<string, Vehicle>>({});
  const [seq, setSeq] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState<{ mode: 'add' } | { mode: 'assign'; itemId: string } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [memoEdit, setMemoEdit] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<QuoteItem | null>(null);
  const [confirmStatus, setConfirmStatus] = useState<QuoteStatus | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flashKey, setFlashKey] = useState(0);

  const existingChanged = Object.keys(itemDrafts).filter((k) => !isNew(k) && !removed.has(k)).length;
  const dirtyCount = existingChanged + added.length + removed.size + Object.keys(headerDraft).length;

  useEffect(() => {
    if (!dirtyCount) return;
    const h = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirtyCount]);

  const locked = !quote || !quote.isLatest || quote.status === 'SENT' || quote.status === 'CONFIRMED';
  const rows = useMemo(() => (quote ? [...quote.items.filter((i) => !removed.has(i.id)), ...added] : []), [quote, removed, added]);

  const val = useCallback(
    <K extends keyof ItemDraft>(it: QuoteItem, k: K): QuoteItem[K] =>
      (itemDrafts[it.id]?.[k] !== undefined ? itemDrafts[it.id][k] : it[k]) as QuoteItem[K],
    [itemDrafts],
  );
  /** 저장 전에 지정한 차량 (새 항목은 항목에 이미 들어 있다) */
  const vehicleOf = (it: QuoteItem): QuoteItemVehicle | null => assigned[it.id] ?? it.vehicle;
  /** 차량을 바꾸면 서버가 새 차량의 현재 단가를 쓴다. 직접 고친 값이 있으면 그 값이 우선. */
  const baseUnit = (it: QuoteItem) => assigned[it.id]?.dailyRate ?? it.unitPrice;
  const unitOf = (it: QuoteItem) => itemDrafts[it.id]?.unitPrice ?? baseUnit(it);
  const startOf = (it: QuoteItem) => (itemDrafts[it.id]?.startDate !== undefined ? itemDrafts[it.id].startDate! : it.startDate);

  // 화면 표시용 미리 계산. 저장하면 서버가 같은 규칙으로 다시 계산한 값으로 바뀐다.
  const preview = useMemo(() => {
    if (!quote) return null;
    const map = new Map<string, { days: number | null; subtotal: number }>();
    let supply = 0;
    for (const it of rows) {
      const d = itemDrafts[it.id];
      const days = daysBetween(d?.startDate !== undefined ? d.startDate : it.startDate, d?.endDate !== undefined ? d.endDate : it.endDate);
      const unit = d?.unitPrice ?? assigned[it.id]?.dailyRate ?? it.unitPrice;
      const subtotal = unit * (d?.quantity ?? it.quantity) * (days ?? 0) + (d?.extraAmount ?? it.extraAmount);
      map.set(it.id, { days, subtotal });
      supply += subtotal;
    }
    const tax = Math.floor(supply * 0.1);
    return { rows: map, supply, tax, total: supply + tax };
  }, [quote, rows, itemDrafts, assigned]);

  const total = preview?.total;
  useEffect(() => {
    if (total !== undefined) setFlashKey((k) => k + 1);
  }, [total]);

  function setItem(itemId: string, patch: ItemDraft) {
    setItemDrafts((d) => ({ ...d, [itemId]: { ...d[itemId], ...patch } }));
    setErrors((e) => ({ ...e, [itemId]: '' }));
  }

  function validate(): boolean {
    if (!quote) return false;
    const err: Record<string, string> = {};
    for (const it of rows) {
      const d = preview?.rows.get(it.id)?.days;
      if (!(val(it, 'quantity') >= 1)) err[it.id] = '대수는 1 이상이어야 합니다.';
      else if (d !== null && d !== undefined && d < 1) err[it.id] = '일수는 1 이상이어야 합니다.';
    }
    const ps = headerDraft.periodStart ?? quote.periodStart;
    const pe = headerDraft.periodEnd ?? quote.periodEnd;
    if (ps && pe && pe < ps) err.header = '촬영 종료일이 시작일보다 앞섭니다.';
    setErrors(err);
    const first = Object.keys(err)[0];
    if (first) document.getElementById(`row-${first}`)?.querySelector<HTMLInputElement>('input')?.focus();
    return !first;
  }

  function resetPending() {
    setItemDrafts({});
    setHeaderDraft({});
    setAdded([]);
    setRemoved(new Set());
    setAssigned({});
  }

  /** 변경분을 모아 POST /quotes/:id/save 한 번으로 보낸다. 실패하면 화면 변경은 그대로 둔다. */
  async function save() {
    if (!quote || !validate()) return;
    const update = Object.entries(itemDrafts)
      .filter(([k, d]) => !isNew(k) && !removed.has(k) && Object.keys(d).length > 0)
      .map(([k, d]) => ({ id: k, ...d }));
    const add = added.map((a) => {
      const d = itemDrafts[a.id] ?? {};
      return {
        vehicleId: a.vehicleId,
        quantity: d.quantity ?? a.quantity,
        startDate: a.startDate,
        endDate: d.endDate !== undefined ? d.endDate : a.endDate,
        unitPrice: d.unitPrice ?? a.unitPrice,
        extraAmount: d.extraAmount ?? a.extraAmount,
        memo: d.memo !== undefined ? d.memo : a.memo,
      };
    });
    const body: QuoteSaveBody = {
      ...(Object.keys(headerDraft).length ? { header: headerDraft } : {}),
      items: { add, update, remove: [...removed] },
    };
    setSaving(true);
    try {
      setData(await quotes.save(id, body));
      resetPending();
      toast('저장했습니다.');
    } catch (e) {
      toast(`저장하지 못했습니다. 입력한 내용은 그대로 두었습니다. ${(e as Error).message}`, { error: true });
    } finally {
      setSaving(false);
    }
  }

  /** 상태 변경은 저장 때 항목 변경과 함께 보낸다. */
  function chooseStatus(next: QuoteStatus) {
    setHeaderDraft((h) => {
      const n = { ...h };
      if (next === quote?.status) delete n.status;
      else n.status = next;
      return n;
    });
    setConfirmStatus(null);
  }

  function onPick(v: Vehicle) {
    if (!picker) return;
    if (picker.mode === 'add') {
      const tempId = `${NEW}${seq}`;
      setSeq((n) => n + 1);
      const item: QuoteItem = {
        id: tempId,
        vehicleId: v.id,
        requirementId: null,
        vehicle: { plateNo: v.plateNo, brand: v.brand, model: v.model, year: v.year, color: v.color, category: v.category },
        label: null,
        role: null,
        usage: null,
        damageExpected: false,
        sceneNos: [],
        quantity: 1,
        startDate: periodStart,
        endDate: periodEnd,
        days: null,
        unitPrice: v.dailyRate,
        extraAmount: 0,
        subtotal: 0,
        memo: null,
      };
      setAdded((l) => [...l, item]);
    } else {
      const itemId = picker.itemId;
      setAssigned((a) => ({ ...a, [itemId]: v }));
      setItem(itemId, { vehicleId: v.id });
    }
    setPicker(null);
  }

  function removeItem(it: QuoteItem) {
    if (isNew(it.id)) setAdded((l) => l.filter((x) => x.id !== it.id));
    else setRemoved((r) => new Set(r).add(it.id));
    setItemDrafts((d) => {
      const n = { ...d };
      delete n[it.id];
      return n;
    });
    setAssigned((a) => {
      const n = { ...a };
      delete n[it.id];
      return n;
    });
    setDeleting(null);
  }

  async function revise() {
    setBusy(true);
    try {
      const q = await quotes.revise(id);
      toast('새 버전을 만들었습니다.');
      router.push(`/quotes/${q.id}`);
    } catch (e) {
      setBusy(false);
      toast((e as Error).message, { error: true });
    }
  }

  if (loading && !quote) return <div className="page"><Skeletons count={6} /></div>;
  if (error || !quote || !preview) return <div className="page"><LoadError message={error ?? '견적서를 불러오지 못했습니다.'} onRetry={reload} /></div>;

  const periodStart = headerDraft.periodStart !== undefined ? headerDraft.periodStart : quote.periodStart;
  const periodEnd = headerDraft.periodEnd !== undefined ? headerDraft.periodEnd : quote.periodEnd;
  const validUntil = headerDraft.validUntil !== undefined ? headerDraft.validUntil : quote.validUntil;
  const memo = headerDraft.memo !== undefined ? headerDraft.memo : quote.memo;
  const status = headerDraft.status ?? quote.status;
  const idx = QUOTE_STATUS_ORDER.indexOf(status);
  const nextStatus = QUOTE_STATUS_ORDER[idx + 1];
  const canRevert = idx > 0 && status !== 'SENT' && status !== 'CONFIRMED';
  const canSave = quote.isLatest && (!locked || dirtyCount > 0);
  const unassigned = rows.filter((it) => !vehicleOf(it)).length;
  const noDays = rows.filter((it) => preview.rows.get(it.id)?.days == null);

  /** 기간이 비어 일수를 계산하지 못한 항목에 견적서 촬영 기간을 채운다 (저장 때 같이 보낸다) */
  function applyPeriod() {
    if (!periodStart || !periodEnd) return;
    for (const it of noDays) {
      if (isNew(it.id)) setAdded((l) => l.map((x) => (x.id === it.id ? { ...x, startDate: periodStart, endDate: periodEnd } : x)));
      else setItem(it.id, { startDate: periodStart, endDate: periodEnd });
    }
  }
  const outOfRange = (it: QuoteItem) => {
    const e = val(it, 'endDate');
    return !!(periodStart && periodEnd && ((startOf(it) && startOf(it)! < periodStart) || (e && e > periodEnd)));
  };

  return (
    <>
      {quote.scriptId && <Stepper scriptId={quote.scriptId} current="quote" analyzed quoteId={quote.id} />}
      <div className="page">
        <div className="crumb">
          <Link href="/quotes">견적서 목록</Link> &gt; {quote.quoteNo}
        </div>
        <div className="head">
          <div>
            <h2>{quote.title} 견적서</h2>
            <p className="sub">
              <span>{quote.quoteNo}</span>
              <span>v{quote.version}</span>
              <QuoteStatusBadge status={status} />
              {dirtyCount > 0 && <span className="unsaved">저장되지 않은 변경 {dirtyCount}건</span>}
            </p>
          </div>
          <div className="act">
            <div style={{ position: 'relative' }}>
              <Button aria-expanded={statusOpen} disabled={!quote.isLatest} onClick={() => setStatusOpen((o) => !o)}>상태 변경 ▾</Button>
              {statusOpen && (
                <div className="menu">
                  {QUOTE_STATUS_ORDER.map((s) => (
                    <button
                      key={s}
                      disabled={!(s === nextStatus || (s === 'DRAFT' && canRevert))}
                      onClick={() => {
                        setStatusOpen(false);
                        if (s === 'CONFIRMED') setConfirmStatus(s);
                        else chooseStatus(s);
                      }}
                    >
                      {s === 'DRAFT' ? '초안으로 되돌리기' : QUOTE_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button disabled title="내보내기(PDF/엑셀)는 아직 지원하지 않습니다">내보내기 ▾</Button>
            {canSave && <Button variant="primary" loading={saving} onClick={save}>저장</Button>}
          </div>
        </div>

        {!quote.isLatest && <Banner tone="info">이전 버전이라 수정할 수 없습니다. 최신 버전에서 수정해 주세요.</Banner>}
        {quote.isLatest && (quote.status === 'SENT' || quote.status === 'CONFIRMED') && (
          <Banner tone="info" action={<Button size="sm" loading={busy} onClick={revise}>새 버전 만들기</Button>}>
            {quote.status === 'SENT' ? '발송한' : '확정한'} 견적서는 수정할 수 없습니다.
          </Banner>
        )}
        {unassigned > 0 && <Banner>차량을 정하지 못한 항목이 {unassigned}건 있습니다.</Banner>}
        {noDays.length > 0 && (
          <Banner
            action={
              !locked && periodStart && periodEnd ? <Button size="sm" onClick={applyPeriod}>견적서 기간 적용</Button> : undefined
            }
          >
            {periodStart && periodEnd
              ? `기간이 없는 항목 ${noDays.length}건은 일수를 계산하지 못해 금액이 0원으로 나옵니다.`
              : `촬영 기간이 없어 항목 ${noDays.length}건의 금액을 계산하지 못했습니다(0원). 촬영 기간을 입력한 뒤 [견적서 기간 적용]을 눌러 주세요.`}
          </Banner>
        )}
        {errors.header && <Banner tone="bad">{errors.header}</Banner>}

        <div className="q-grid">
          <div>
            <dl className="panel meta">
              <div><dt>작품명</dt><dd>{quote.title}</dd></div>
              <div><dt>작성일</dt><dd>{fmtDate(quote.createdAt)}</dd></div>
              <div><dt>제작사</dt><dd>{quote.productionCompany}</dd></div>
              <div>
                <dt>유효기간</dt>
                <dd><input type="date" className="inp" aria-label="유효기간" disabled={locked} value={validUntil ?? ''} onChange={(e) => setHeaderDraft((h) => ({ ...h, validUntil: e.target.value || null }))} /></dd>
              </div>
              <div>
                <dt>촬영 기간</dt>
                <dd>
                  {locked ? (
                    fmtPeriod(quote.periodStart, quote.periodEnd, quote.days)
                  ) : (
                    <div className="two">
                      <input type="date" className="inp" aria-label="촬영 시작일" value={periodStart ?? ''} onChange={(e) => setHeaderDraft((h) => ({ ...h, periodStart: e.target.value || null }))} />
                      <span>~</span>
                      <input type="date" className="inp" aria-label="촬영 종료일" value={periodEnd ?? ''} onChange={(e) => setHeaderDraft((h) => ({ ...h, periodEnd: e.target.value || null }))} />
                    </div>
                  )}
                </dd>
              </div>
              <div>
                <dt>부가세</dt>
                <dd>
                  <select className="inp" aria-label="부가세 기준" disabled title="부가세는 현재 별도 10%로 고정입니다">
                    <option>별도 10%</option>
                  </select>
                </dd>
              </div>
              <div><dt>담당자</dt><dd>{quote.author ?? '-'}</dd></div>
              <div />
            </dl>

            <div className="items-head">
              <h3>차량 항목 {rows.length}건</h3>
              {!locked && <Button size="sm" onClick={() => setPicker({ mode: 'add' })}>항목 추가</Button>}
            </div>
            {rows.length === 0 ? (
              <div className="panel">
                <EmptyState
                  title="견적서에 차량 항목이 없습니다"
                  description="보유 차량에서 직접 추가하거나 차량 매칭에서 다시 생성할 수 있습니다."
                  action={!locked ? <Button variant="primary" onClick={() => setPicker({ mode: 'add' })}>항목 추가</Button> : undefined}
                />
              </div>
            ) : (
              <div className="panel" style={{ overflowX: 'auto' }}>
                <table className="lines">
                  <thead>
                    <tr>
                      <th style={{ width: 250 }}>차량</th>
                      <th className="num" style={{ width: 64 }}>대수</th>
                      <th className="num" style={{ width: 64 }}>일수</th>
                      <th className="num" style={{ width: 110 }}>일 단가</th>
                      <th className="num" style={{ width: 110 }}>추가 비용</th>
                      <th className="num" style={{ width: 120 }}>소계</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((it) => {
                      const pendingCls = vehicleOf(it) ? '' : ' pending';
                      const row = preview.rows.get(it.id)!;
                      const unitPrice = unitOf(it);
                      const veh = vehicleOf(it);
                      const extra = val(it, 'extraAmount');
                      const itemMemo = val(it, 'memo');
                      const start = startOf(it);
                      const period = fmtShortPeriod(start, val(it, 'endDate'));
                      return (
                        <Fragment key={it.id}>
                          <tr id={`row-${it.id}`} className={pendingCls.trim() || undefined}>
                            <td>
                              <div className="row" style={{ flexWrap: 'nowrap' }}>
                                <PlateChip plateNo={veh?.plateNo} />
                                <span>{veh ? vehicleName(veh) : '차량 미정'}</span>
                                {!veh && !locked && <Button size="sm" onClick={() => setPicker({ mode: 'assign', itemId: it.id })}>차량 선택</Button>}
                              </div>
                            </td>
                            <td>
                              <input className="cell" inputMode="numeric" aria-label="대수" disabled={locked} value={val(it, 'quantity')} onFocus={(e) => e.target.select()} onChange={(e) => setItem(it.id, { quantity: digits(e.target.value) })} />
                            </td>
                            <td>
                              <input
                                className="cell"
                                inputMode="numeric"
                                aria-label="일수"
                                disabled={locked || !start}
                                title={start ? undefined : '기간이 없는 항목입니다. 위의 [견적서 기간 적용]으로 채울 수 있습니다.'}
                                value={row.days ?? ''}
                                onFocus={(e) => e.target.select()}
                                onChange={(e) => start && setItem(it.id, { endDate: endFromDays(start, Math.max(1, digits(e.target.value))) })}
                              />
                            </td>
                            <td>
                              <input className="cell" inputMode="numeric" aria-label="일 단가" disabled={locked} value={won(unitPrice)} onFocus={(e) => e.target.select()} onChange={(e) => setItem(it.id, { unitPrice: digits(e.target.value) })} />
                              {unitPrice !== baseUnit(it) && <span className="base">기본 {won(baseUnit(it))}원</span>}
                            </td>
                            <td>
                              <input className="cell" inputMode="numeric" aria-label="추가 비용" disabled={locked} value={won(extra)} onFocus={(e) => e.target.select()} onChange={(e) => setItem(it.id, { extraAmount: digits(e.target.value) })} />
                            </td>
                            <td className="sumcell" title={`${won(unitPrice)} × ${val(it, 'quantity')}대 × ${row.days ?? 0}일 + ${won(extra)}`}>
                              {won(row.subtotal)}원
                            </td>
                            <td className="menu-cell">
                              {!locked && (
                                <>
                                  <Button variant="ghost" size="sm" aria-label="더보기" aria-expanded={menu === it.id} onClick={() => setMenu(menu === it.id ? null : it.id)}>⋯</Button>
                                  {menu === it.id && (
                                    <div className="menu">
                                      <button onClick={() => { setMenu(null); setMemoEdit(it.id); }}>메모 편집</button>
                                      <button className="bad" onClick={() => { setMenu(null); setDeleting(it); }}>항목 삭제</button>
                                    </div>
                                  )}
                                </>
                              )}
                            </td>
                          </tr>
                          <tr className={`sub${pendingCls}`}>
                            <td colSpan={7}>
                              <div className="tags">
                                {it.role && <RoleTag role={it.role} />}
                                {it.usage && <UsageTag usage={it.usage} />}
                                {it.damageExpected && <span className="pill bad">✕ 파손 예정</span>}
                                {it.sceneNos.length > 0 && <span>씬 {it.sceneNos.join(', ')}{!vehicleOf(it) && it.label ? ` ${it.label}` : ''}</span>}
                                {it.sceneNos.length === 0 && !vehicleOf(it) && it.label && <span>{it.label}</span>}
                                {isNew(it.id) && <span className="pill run">새 항목</span>}
                                {period && <span>{period}</span>}
                                {outOfRange(it) && <span style={{ color: 'var(--warn-fg)' }}>⚠ 촬영 기간을 벗어났습니다</span>}
                                {memoEdit === it.id ? (
                                  <input className="inp sm" style={{ maxWidth: 320 }} autoFocus aria-label="메모" value={itemMemo ?? ''} onChange={(e) => setItem(it.id, { memo: e.target.value || null })} onBlur={() => setMemoEdit(null)} onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && setMemoEdit(null)} />
                                ) : (
                                  itemMemo && <span>메모: {itemMemo}</span>
                                )}
                              </div>
                              {errors[it.id] && <p className="err" role="alert" style={{ marginTop: 6 }}>{errors[it.id]}</p>}
                            </td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="memo field">
              <label htmlFor="memo">비고</label>
              <textarea id="memo" className="inp" placeholder="제작사에 전달할 내용을 입력하세요." disabled={locked} value={memo ?? ''} onChange={(e) => setHeaderDraft((h) => ({ ...h, memo: e.target.value || null }))} />
            </div>

            <div className="row" style={{ marginTop: 24 }}>
              {quote.scriptId && <Link className="btn" href={`/scripts/${quote.scriptId}`}>대본 상세로</Link>}
              <Link className="btn" href="/quotes">목록으로</Link>
            </div>
          </div>

          <aside className="panel totals" aria-label="합계">
            <div className="line"><span>공급가액</span><b>{won(preview.supply)}원</b></div>
            <div className="line"><span>부가세 10%</span><b>{won(preview.tax)}원</b></div>
            <hr />
            <div className="line" style={{ color: 'var(--ink)' }}><span>합계</span></div>
            <div key={flashKey} className={`grand${flashKey > 1 ? ' flash' : ''}`}>
              {won(preview.total)}<small>원</small>
            </div>
            {dirtyCount > 0 && <p className="caption muted" style={{ textAlign: 'right' }}>저장 전 미리 계산한 금액입니다.</p>}
            <Button disabled title="내보내기(PDF/엑셀)는 아직 지원하지 않습니다">내보내기</Button>
          </aside>
        </div>
      </div>

      {picker && <VehiclePicker onPick={onPick} onClose={() => setPicker(null)} />}
      {deleting && (
        <ConfirmModal
          title="항목을 삭제합니다"
          body={`${vehicleOf(deleting) ? vehicleName(vehicleOf(deleting)!) : '차량 미정'} 항목이 삭제됩니다. 저장하면 견적서에 반영됩니다.`}
          confirmLabel="삭제"
          danger
          onConfirm={() => removeItem(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
      {confirmStatus && (
        <ConfirmModal
          title="견적서를 확정합니다"
          body="저장하면 확정되어 수정할 수 없습니다. 다시 수정하려면 새 버전을 만들어야 합니다."
          confirmLabel="확정"
          busy={busy}
          onConfirm={() => chooseStatus(confirmStatus)}
          onClose={() => setConfirmStatus(null)}
        />
      )}
    </>
  );
}
