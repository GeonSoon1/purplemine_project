'use client';

import { useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { analysis as api, quotes } from '@/lib/api';
import type { Analysis, Candidate, Requirement, Scene, Vehicle } from '@/lib/types';
import { useLoad } from '@/lib/use-load';
import { useScriptContext } from '@/lib/use-script-context';
import { vehicleName } from '@/lib/format';
import { Banner, Button, EmptyState, LinkButton, LoadError, Skeletons, won } from '@/components/ui';
import { PlateChip, RoleTag, SceneNumber, ScoreBar, UsageTag, highlight } from '@/components/tags';
import { Stepper } from '@/components/Stepper';
import { ConfirmModal } from '@/components/Modal';
import { VehiclePicker } from '@/components/VehiclePicker';
import { useToast } from '@/components/Toast';

type Filter = 'all' | 'pending' | 'none';

const isDone = (r: Requirement) => r.selectedCount >= r.quantity;
const isNone = (r: Requirement) => r.candidates.length === 0;
const selectedIds = (r: Requirement) => r.candidates.filter((c) => c.isSelected).map((c) => c.vehicleId);

export default function MatchingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { script, quoteId } = useScriptContext(id);

  const fetcher = useCallback(() => api.get(id), [id]);
  const { data, error, loading, reload, setData } = useLoad<Analysis>(fetcher);

  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const [pickerFor, setPickerFor] = useState<Requirement | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [confirmCreate, setConfirmCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [drawer, setDrawer] = useState<Scene | null>(null);

  const reqs = useMemo(() => data?.scenes.flatMap((s) => s.requirements) ?? [], [data]);
  const sceneOf = useMemo(() => new Map(data?.scenes.map((s) => [s.id, s]) ?? []), [data]);

  function replace(req: Requirement) {
    if (!data) return;
    setData({
      ...data,
      scenes: data.scenes.map((s) =>
        s.id === req.sceneId ? { ...s, requirements: s.requirements.map((r) => (r.id === req.id ? req : r)) } : s,
      ),
    });
  }

  async function setSelection(r: Requirement, vehicleIds: string[]) {
    setPending(r.id);
    try {
      replace(await api.select(r.id, vehicleIds));
      setRowError((e) => ({ ...e, [r.id]: '' }));
      return true;
    } catch (e) {
      // 실패하면 화면 상태는 이전 값 그대로 둔다.
      setRowError((er) => ({ ...er, [r.id]: `선택을 저장하지 못했습니다. ${(e as Error).message}` }));
      return false;
    } finally {
      setPending(null);
    }
  }

  function toggle(r: Requirement, c: Candidate) {
    const cur = selectedIds(r);
    setSelection(r, c.isSelected ? cur.filter((v) => v !== c.vehicleId) : [...cur, c.vehicleId]);
  }

  async function pickOther(v: Vehicle) {
    const r = pickerFor;
    if (!r) return;
    const cur = selectedIds(r);
    if (cur.includes(v.id)) return setPickerFor(null);
    if (cur.length >= r.quantity) {
      toast('필요한 대수를 모두 선택했습니다. 선택을 해제한 뒤 추가해 주세요.', { error: true });
      return;
    }
    if (await setSelection(r, [...cur, v.id])) setPickerFor(null);
  }

  async function rematch(r: Requirement) {
    setPending(r.id);
    try {
      replace(await api.rematch(r.id));
      setRowError((e) => ({ ...e, [r.id]: '' }));
      toast('후보를 다시 찾았습니다.');
    } catch (e) {
      setRowError((er) => ({ ...er, [r.id]: `후보를 다시 찾지 못했습니다. ${(e as Error).message}` }));
    } finally {
      setPending(null);
    }
  }

  async function createQuote() {
    setCreating(true);
    try {
      const q = await quotes.create({ scriptId: id });
      toast('견적서를 만들었습니다.');
      router.push(`/quotes/${q.id}`);
    } catch (e) {
      setCreating(false);
      setConfirmCreate(false);
      toast((e as Error).message, { error: true });
    }
  }

  const analyzed = data?.status === 'ANALYZED';
  const title = script?.title ?? '';
  const doneCount = reqs.filter(isDone).length;
  const noneCount = reqs.filter((r) => !isDone(r) && isNone(r)).length;
  const pendingCount = reqs.length - doneCount - noneCount;
  const unsettled = reqs.length - doneCount;
  const shown = reqs.filter((r) =>
    filter === 'all' ? true : filter === 'none' ? !isDone(r) && isNone(r) : !isDone(r) && !isNone(r),
  );
  const canCreate = analyzed && reqs.length > 0;

  function createClick() {
    if (unsettled > 0) setConfirmCreate(true);
    else createQuote();
  }

  return (
    <>
      <Stepper scriptId={id} current="matching" analyzed={analyzed} quoteId={quoteId} />
      <div className="page">
        <div className="crumb">
          <Link href="/scripts">대본 목록</Link> &gt; <Link href={`/scripts/${id}`}>{title || '대본 상세'}</Link>
        </div>
        <div className="head">
          <div><h2>{title} 차량 매칭</h2></div>
          <div className="act">
            <Button variant="primary" loading={creating} disabled={!canCreate} onClick={createClick}>견적서 생성</Button>
          </div>
        </div>

        {loading && !data && <Skeletons count={6} />}
        {error && <LoadError message={error} onRetry={reload} />}
        {data && !analyzed && <Banner tone="info">아직 분석 중입니다. 분석이 끝나면 매칭할 수 있습니다.</Banner>}

        {data && analyzed && reqs.length === 0 && (
          <div className="panel">
            <EmptyState
              title="매칭할 요구사항이 없습니다"
              description="분석 결과에서 요구사항을 추가해 주세요."
              action={<LinkButton href={`/scripts/${id}/analysis`}>분석 결과로</LinkButton>}
            />
          </div>
        )}

        {data && analyzed && reqs.length > 0 && (
          <>
            <div className="stats">
              <button className="stat" onClick={() => setFilter('all')}><b>{reqs.length}</b><span>요구사항</span></button>
              <div className="stat"><b>{doneCount}</b><span>선택 완료</span></div>
              <button className="stat" onClick={() => setFilter('none')}><b>{noneCount}</b><span>후보 없음</span></button>
              <button className="stat" onClick={() => setFilter('pending')}><b>{pendingCount}</b><span>선택 전</span></button>
            </div>
            <div className="filters">
              <button className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>전체</button>
              <button className="chip" aria-pressed={filter === 'pending'} onClick={() => setFilter('pending')}>선택 전</button>
              <button className="chip" aria-pressed={filter === 'none'} onClick={() => setFilter('none')}>후보 없음</button>
              <span className="help" style={{ marginLeft: 'auto', fontSize: 14 }}>가용 일정은 직접 확인해 주세요.</span>
            </div>

            <div className="panel">
              {shown.length === 0 && <EmptyState title="조건에 맞는 항목이 없습니다" action={<Button onClick={() => setFilter('all')}>필터 해제</Button>} />}
              {shown.map((r, i) => {
                const scene = sceneOf.get(r.sceneId);
                const sameScene = shown[i - 1]?.sceneId === r.sceneId;
                const expanded = showAll.has(r.id);
                const cands = expanded ? r.candidates : r.candidates.slice(0, 3);
                const lowAll = r.candidates.length > 0 && r.candidates.every((c) => c.score < 50);
                const full = isDone(r);
                const busy = pending === r.id;
                return (
                  <div key={r.id} className="block">
                    <div className="bhead">
                      <SceneNumber no={r.sceneNo} small hidden={sameScene} />
                      <RoleTag role={r.role} />
                      <span className="need">{r.vehicleType} {r.quantity}대</span>
                      <UsageTag usage={r.usage} />
                      {r.damageExpected && <span className="pill bad">✕ 파손 예정</span>}
                      <span className="right row">
                        {lowAll && <span className="pill warn">일치도 낮음</span>}
                        {full && <span className="pill ok">✓ 선택 완료</span>}
                        <span>필요 {r.quantity}대, 선택 <b>{r.selectedCount}</b>대</span>
                      </span>
                    </div>
                    {(r.sourceQuote || scene?.sourceText) && (
                      <p className="bsrc">
                        {r.sourceQuote && <span>원문: “{r.sourceQuote}”</span>}
                        {scene?.sourceText && <Button variant="ghost" size="sm" onClick={() => setDrawer(scene)}>원문 보기</Button>}
                      </p>
                    )}

                    <div className="cands">
                      {r.candidates.length === 0 ? (
                        <div className="empty-slot">
                          <span>같은 조건의 보유 차량을 찾지 못했습니다.</span>
                          <Button onClick={() => setPickerFor(r)}>다른 차량 찾기</Button>
                        </div>
                      ) : (
                        cands.map((c) => {
                          const damageWarn = (r.damageExpected || r.usage === 'DAMAGE') && !c.vehicle.damageAllowed;
                          const blocked = !c.isSelected && full;
                          return (
                            <div key={c.id} className={`cand${c.isSelected ? ' sel' : ''}`}>
                              <PlateChip plateNo={c.vehicle.plateNo} />
                              <span className="m">{vehicleName(c.vehicle)}</span>
                              <ScoreBar score={c.score} />
                              <span className="price">일 {won(c.vehicle.dailyRate)}원</span>
                              <p className="why" title={c.reason}>{c.reason}</p>
                              {damageWarn && <span className="flag">파손 촬영 불가</span>}
                              <Button
                                disabled={blocked || busy}
                                title={blocked ? '필요한 대수를 모두 선택했습니다.' : undefined}
                                aria-pressed={c.isSelected}
                                onClick={() => toggle(r, c)}
                              >
                                {c.isSelected ? '선택됨 ✓' : '선택'}
                              </Button>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="block-actions">
                      {r.candidates.length > 3 && !expanded && (
                        <Button variant="ghost" size="sm" onClick={() => setShowAll((s) => new Set(s).add(r.id))}>후보 더 보기 ({r.candidates.length - 3})</Button>
                      )}
                      {r.candidates.length > 0 && <Button variant="ghost" size="sm" onClick={() => setPickerFor(r)}>다른 차량 찾기</Button>}
                      <Button variant="ghost" size="sm" loading={busy} onClick={() => rematch(r)}>후보 다시 찾기</Button>
                    </div>
                    {rowError[r.id] && <p className="err block-err" role="alert">{rowError[r.id]}</p>}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {canCreate && (
        <div className="bottombar">
          <div className="bottombar-inner">
            <span>요구사항 {reqs.length}건 중 {doneCount}건을 선택했습니다.</span>
            <Button variant="primary" loading={creating} onClick={createClick}>견적서 생성</Button>
          </div>
        </div>
      )}

      {drawer && (
        <aside className="drawer" aria-label={`씬 ${drawer.sceneNo} 원문`}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
            <h4 style={{ fontSize: 18 }}>씬 {drawer.sceneNo} 원문</h4>
            <Button variant="ghost" size="sm" aria-label="닫기" onClick={() => setDrawer(null)}>✕</Button>
          </div>
          <pre>{highlight(drawer.sourceText ?? '', drawer.requirements.map((x) => x.sourceQuote))}</pre>
        </aside>
      )}
      {pickerFor && <VehiclePicker busy={pending === pickerFor.id} onPick={pickOther} onClose={() => setPickerFor(null)} />}
      {confirmCreate && (
        <ConfirmModal
          title="견적서를 만듭니다"
          body={`차량을 정하지 못한 요구사항 ${unsettled}건은 '차량 미정' 항목으로 들어갑니다. 견적서에서 직접 채울 수 있습니다.`}
          confirmLabel="견적서 생성"
          cancelLabel="계속 선택"
          busy={creating}
          onConfirm={createQuote}
          onClose={() => setConfirmCreate(false)}
        />
      )}
    </>
  );
}
