'use client';

import { Fragment, useCallback, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { analysis as api } from '@/lib/api';
import type { Analysis, Requirement, Role, Scene, Usage } from '@/lib/types';
import { CATEGORY_LABEL, ROLES, ROLE_LABEL, TIME_LABEL, USAGES, USAGE_LABEL, confidenceLevel, fmtPeriod } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { useScriptContext } from '@/lib/use-script-context';
import { Banner, Button, EmptyState, LinkButton, LoadError, Skeletons } from '@/components/ui';
import { Confidence, DamageTag, RoleTag, SceneNumber, UsageTag, highlight } from '@/components/tags';
import { Stepper } from '@/components/Stepper';
import { ConfirmModal } from '@/components/Modal';
import { useToast } from '@/components/Toast';

type Filter = 'all' | 'check' | 'edited';

const needsCheck = (r: Requirement) =>
  !r.isUserEdited && r.confidence !== null && confidenceLevel(r.confidence) !== 'high';

interface Draft {
  sceneId: string;
  role: Role;
  vehicleType: string;
  quantity: number;
  usage: Usage;
  damageExpected: boolean;
}
const toDraft = (r: Requirement): Draft => ({
  sceneId: r.sceneId,
  role: r.role,
  vehicleType: r.vehicleType,
  quantity: r.quantity,
  usage: r.usage,
  damageExpected: r.damageExpected,
});
const emptyDraft = (sceneId: string): Draft => ({ sceneId, role: 'SUPPORT', vehicleType: '', quantity: 1, usage: 'NORMAL', damageExpected: false });

function DraftForm({
  draft,
  scenes,
  onChange,
  onSave,
  onCancel,
  busy,
  saveLabel,
  error,
}: {
  draft: Draft;
  /** 넘기면 씬도 고를 수 있다 (상단 [요구사항 추가]) */
  scenes?: Scene[];
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  saveLabel: string;
  error?: string;
}) {
  return (
    <>
      <form
        className={`draft${scenes ? ' with-scene' : ''}`}
        onSubmit={(e) => { e.preventDefault(); onSave(); }}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
      >
        {scenes && (
          <select className="inp sm" aria-label="씬" value={draft.sceneId} onChange={(e) => onChange({ ...draft, sceneId: e.target.value })}>
            {scenes.map((s) => <option key={s.id} value={s.id}>씬 {s.sceneNo} {s.location ?? ''}</option>)}
          </select>
        )}
        <select className="inp sm" aria-label="역할" value={draft.role} onChange={(e) => onChange({ ...draft, role: e.target.value as Role })}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <input className="inp sm" aria-label="차종 요구" placeholder="차종 요구 (예: 검정 대형 세단)" autoFocus value={draft.vehicleType} onChange={(e) => onChange({ ...draft, vehicleType: e.target.value })} />
        <input className="inp sm num" type="number" min={1} aria-label="대수" value={draft.quantity} onChange={(e) => onChange({ ...draft, quantity: Number(e.target.value) })} />
        <select className="inp sm" aria-label="용도" value={draft.usage} onChange={(e) => onChange({ ...draft, usage: e.target.value as Usage })}>
          {USAGES.map((u) => <option key={u} value={u}>{USAGE_LABEL[u]}</option>)}
        </select>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          <label className="row small" style={{ flexWrap: 'nowrap' }}>
            <input type="checkbox" checked={draft.damageExpected} onChange={(e) => onChange({ ...draft, damageExpected: e.target.checked })} />
            파손
          </label>
          <Button size="sm" variant="primary" type="submit" loading={busy}>{saveLabel}</Button>
          <Button size="sm" onClick={onCancel}>취소</Button>
        </div>
      </form>
      {error && <p className="err" role="alert" style={{ marginTop: 6 }}>{error}</p>}
    </>
  );
}

export default function AnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { script, quoteId } = useScriptContext(id);

  const fetcher = useCallback(() => api.get(id), [id]);
  const { data, error, loading, reload, setData } = useLoad<Analysis>(fetcher);

  const [filter, setFilter] = useState<Filter>('all');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [usageFilter, setUsageFilter] = useState<Usage | ''>('');
  const [open, setOpen] = useState<Set<string> | null>(null);
  const [openReq, setOpenReq] = useState<string | null>(null);
  const [menuReq, setMenuReq] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** 씬 id, 또는 'top' (상단 [요구사항 추가]) */
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft(''));
  const [stale, setStale] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<Scene | null>(null);
  const [confirmGo, setConfirmGo] = useState(false);
  const [deleting, setDeleting] = useState<Requirement | null>(null);

  const scenes = useMemo(() => data?.scenes ?? [], [data]);
  const allReqs = useMemo(() => scenes.flatMap((s) => s.requirements), [scenes]);
  const checkCount = allReqs.filter(needsCheck).length;
  const editedCount = allReqs.filter((r) => r.isUserEdited).length;
  const narrowed = filter !== 'all' || !!roleFilter || !!usageFilter;

  const matches = (r: Requirement) =>
    (filter === 'all' || (filter === 'check' ? needsCheck(r) : r.isUserEdited)) &&
    (!roleFilter || r.role === roleFilter) &&
    (!usageFilter || r.usage === usageFilter);

  // 확인 필요 항목이 있는 씬은 처음부터 펼친다. 필터를 걸면 걸린 씬을 모두 펼친다.
  const isOpen = (s: Scene) => (open ? open.has(s.id) : narrowed || s.requirements.some(needsCheck));
  function toggle(s: Scene) {
    const next = new Set(open ?? scenes.filter(isOpen).map((x) => x.id));
    if (next.has(s.id)) next.delete(s.id);
    else next.add(s.id);
    setOpen(next);
  }
  function changeFilter(f: Filter) {
    setFilter(f);
    setOpen(null);
  }

  function patchLocal(req: Requirement) {
    if (!data) return;
    setData({
      ...data,
      scenes: data.scenes.map((s) =>
        s.id === req.sceneId ? { ...s, requirements: s.requirements.map((r) => (r.id === req.id ? req : r)) } : s,
      ),
    });
  }

  const invalid = (d: Draft) => !d.vehicleType.trim() || !(d.quantity >= 1);
  const INVALID_MSG = '차종 요구를 입력하고 대수는 1 이상으로 입력해 주세요.';
  const SAVE_FAIL = '저장하지 못했습니다. 입력한 내용은 그대로 두었습니다.';

  async function saveEdit(r: Requirement) {
    if (invalid(draft)) return setFormError((e) => ({ ...e, [r.id]: INVALID_MSG }));
    setBusy(true);
    try {
      const updated = await api.updateRequirement(r.id, {
        role: draft.role,
        vehicleType: draft.vehicleType.trim(),
        quantity: draft.quantity,
        usage: draft.usage,
        damageExpected: draft.damageExpected,
      });
      patchLocal(updated);
      if (updated.candidatesStale) setStale((s) => new Set(s).add(r.id));
      setEditing(null);
      setFormError((e) => ({ ...e, [r.id]: '' }));
      toast('저장했습니다.');
    } catch {
      setFormError((e) => ({ ...e, [r.id]: SAVE_FAIL }));
    } finally {
      setBusy(false);
    }
  }

  async function rematch(r: Requirement) {
    try {
      patchLocal(await api.rematch(r.id));
      setStale((s) => {
        const n = new Set(s);
        n.delete(r.id);
        return n;
      });
      toast('후보를 다시 찾았습니다.');
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  async function addReq(key: string) {
    if (invalid(draft)) return setFormError((e) => ({ ...e, [key]: INVALID_MSG }));
    setBusy(true);
    try {
      const created = await api.addRequirement(id, {
        sceneId: draft.sceneId,
        role: draft.role,
        vehicleType: draft.vehicleType.trim(),
        quantity: draft.quantity,
        usage: draft.usage,
        damageExpected: draft.damageExpected,
      });
      if (data) {
        setData({
          ...data,
          scenes: data.scenes.map((s) => (s.id === draft.sceneId ? { ...s, requirements: [...s.requirements, created] } : s)),
        });
      }
      setOpen((o) => new Set(o ?? scenes.filter(isOpen).map((x) => x.id)).add(draft.sceneId));
      setAdding(null);
      setFormError((e) => ({ ...e, [key]: '' }));
      toast('추가했습니다.');
    } catch {
      setFormError((e) => ({ ...e, [key]: SAVE_FAIL }));
    } finally {
      setBusy(false);
    }
  }

  async function removeReq(r: Requirement) {
    setBusy(true);
    try {
      await api.removeRequirement(r.id);
      if (data) {
        setData({
          ...data,
          scenes: data.scenes.map((s) =>
            s.id === r.sceneId ? { ...s, requirements: s.requirements.filter((x) => x.id !== r.id) } : s,
          ),
        });
      }
      setDeleting(null);
      toast('삭제했습니다.');
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  const analyzed = data?.status === 'ANALYZED';
  const title = script?.title ?? '';
  const shownScenes = scenes.filter((s) => !narrowed || s.requirements.some(matches));

  return (
    <>
      <Stepper scriptId={id} current="analysis" analyzed={analyzed} quoteId={quoteId} />
      <div className="page">
        <div className="crumb">
          <Link href="/scripts">대본 목록</Link> &gt; <Link href={`/scripts/${id}`}>{title || '대본 상세'}</Link>
        </div>
        <div className="head">
          <div>
            <h2>{title} 분석 결과</h2>
            {script && (
              <p className="sub">
                <span>제작사 <b>{script.productionCompany}</b></span>
                {script.shootStart && <span>촬영 예정 <b>{fmtPeriod(script.shootStart, script.shootEnd)}</b></span>}
              </p>
            )}
          </div>
          <div className="act">
            <LinkButton href={`/scripts/${id}/matching`} variant="primary" disabled={!analyzed} title="분석이 끝나면 볼 수 있습니다">
              차량 매칭으로
            </LinkButton>
          </div>
        </div>

        {loading && !data && <Skeletons count={6} />}
        {error && <LoadError message={error} onRetry={reload} />}

        {data && !analyzed && (
          <Banner tone="info" action={<LinkButton href={`/scripts/${id}`} size="sm">대본 상세로</LinkButton>}>
            아직 분석 중입니다.
          </Banner>
        )}

        {data && analyzed && (
          <>
            <div className="stats">
              <button className="stat" onClick={() => changeFilter('all')}><b>{scenes.length}</b><span>씬</span></button>
              <button className="stat" onClick={() => changeFilter('all')}><b>{allReqs.length}</b><span>차량 요구</span></button>
              <button className="stat" onClick={() => changeFilter('check')}><b>{checkCount}</b><span>확인 필요</span></button>
              <button className="stat" onClick={() => changeFilter('edited')}><b>{editedCount}</b><span>수정함</span></button>
            </div>

            <div className="filters">
              <button className="chip" aria-pressed={filter === 'all'} onClick={() => changeFilter('all')}>전체</button>
              <button className="chip" aria-pressed={filter === 'check'} onClick={() => changeFilter('check')}>확인 필요 {checkCount}</button>
              <button className="chip" aria-pressed={filter === 'edited'} onClick={() => changeFilter('edited')}>수정함 {editedCount}</button>
              <select className={`chip${roleFilter ? ' on' : ''}`} aria-label="역할 필터" value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value as Role | ''); setOpen(null); }}>
                <option value="">역할 ▾</option>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <select className={`chip${usageFilter ? ' on' : ''}`} aria-label="용도 필터" value={usageFilter} onChange={(e) => { setUsageFilter(e.target.value as Usage | ''); setOpen(null); }}>
                <option value="">용도 ▾</option>
                {USAGES.map((u) => <option key={u} value={u}>{USAGE_LABEL[u]}</option>)}
              </select>
              <span style={{ marginLeft: 'auto' }} />
              {scenes.length > 0 && (
                <Button size="sm" onClick={() => { setAdding('top'); setEditing(null); setDraft(emptyDraft(scenes[0].id)); }}>요구사항 추가</Button>
              )}
            </div>
            {adding === 'top' && (
              <div style={{ marginBottom: 16 }}>
                <DraftForm draft={draft} scenes={scenes} onChange={setDraft} onSave={() => addReq('top')} onCancel={() => setAdding(null)} busy={busy} saveLabel="추가" error={formError.top} />
              </div>
            )}

            {scenes.length === 0 && (
              <div className="panel"><EmptyState title="씬을 찾지 못했습니다" description="대본 파일을 확인하고 대본 상세에서 다시 분석해 주세요." /></div>
            )}
            {scenes.length > 0 && allReqs.length === 0 && !narrowed && (
              <Banner tone="info">차량이 필요한 씬을 찾지 못했습니다. 씬마다 요구사항을 직접 추가할 수 있습니다.</Banner>
            )}
            {narrowed && shownScenes.length === 0 && (
              <div className="panel">
                <EmptyState title="조건에 맞는 항목이 없습니다" action={<Button onClick={() => { changeFilter('all'); setRoleFilter(''); setUsageFilter(''); }}>필터 해제</Button>} />
              </div>
            )}

            {shownScenes.length > 0 && (
              <div className="panel">
                {shownScenes.map((s) => {
                  const expanded = isOpen(s);
                  const reqs = s.requirements.filter((r) => !narrowed || matches(r));
                  return (
                    <div key={s.id} className="scene">
                      <button className="scene-head" aria-expanded={expanded} onClick={() => toggle(s)}>
                        <SceneNumber no={s.sceneNo} />
                        <span className="t">
                          <h4>{s.location ?? '장소 미상'} {TIME_LABEL[s.timeOfDay] && <small>{TIME_LABEL[s.timeOfDay]}</small>}</h4>
                          {s.summary && <p className="sum">{s.summary}</p>}
                        </span>
                        <span className="cnt">
                          {s.requirements.length ? `차량 요구 ${s.requirements.length}건` : '차량 없음'}
                          <span className={`chev${expanded ? ' up' : ''}`} aria-hidden>⌄</span>
                        </span>
                      </button>
                      {expanded && (
                        <div className="scene-body">
                          {reqs.length > 0 && (
                            <table className="req">
                              <thead>
                                <tr><th>역할</th><th>차종 요구</th><th className="num">대수</th><th>용도</th><th>파손</th><th>신뢰도</th><th /></tr>
                              </thead>
                              <tbody>
                                {reqs.map((r) => (
                                  <Fragment key={r.id}>
                                    <tr
                                      className={`req-row${r.isUserEdited ? ' edited' : ''}`}
                                      tabIndex={0}
                                      aria-expanded={openReq === r.id}
                                      onClick={() => setOpenReq(openReq === r.id ? null : r.id)}
                                      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget === e.target && setOpenReq(openReq === r.id ? null : r.id)}
                                    >
                                      <td><RoleTag role={r.role} /></td>
                                      <td>
                                        {r.vehicleType}
                                        {r.brandModelHint ? <span className="hint">대본 명시: {r.brandModelHint}</span> : r.categoryHint && <span className="hint">{CATEGORY_LABEL[r.categoryHint]}</span>}
                                      </td>
                                      <td className="num">{r.quantity}</td>
                                      <td><UsageTag usage={r.usage} /></td>
                                      <td><DamageTag expected={r.damageExpected} /></td>
                                      <td><Confidence value={r.confidence} edited={r.isUserEdited} /></td>
                                      <td className="menu-cell" onClick={(e) => e.stopPropagation()}>
                                        <Button variant="ghost" size="sm" aria-label="더보기" aria-expanded={menuReq === r.id} onClick={() => setMenuReq(menuReq === r.id ? null : r.id)}>⋯</Button>
                                        {menuReq === r.id && (
                                          <div className="menu">
                                            <button onClick={() => { setMenuReq(null); setAdding(null); setEditing(r.id); setDraft(toDraft(r)); }}>요구사항 수정</button>
                                            <button className="bad" onClick={() => { setMenuReq(null); setDeleting(r); }}>삭제</button>
                                          </div>
                                        )}
                                      </td>
                                    </tr>
                                    {editing === r.id && (
                                      <tr><td colSpan={7}>
                                        <DraftForm draft={draft} onChange={setDraft} onSave={() => saveEdit(r)} onCancel={() => setEditing(null)} busy={busy} saveLabel="저장" error={formError[r.id]} />
                                      </td></tr>
                                    )}
                                    {stale.has(r.id) && (
                                      <tr><td colSpan={7}>
                                        <div className="inline-banner">
                                          <span style={{ flex: 1 }}>⚠ 요구사항이 수정되었습니다. 후보를 다시 찾으시겠습니까?</span>
                                          <Button size="sm" onClick={() => rematch(r)}>후보 다시 찾기</Button>
                                        </div>
                                      </td></tr>
                                    )}
                                    {openReq === r.id && (
                                      <tr><td colSpan={7}>
                                        <div className="quote">
                                          {r.sourceQuote ? <>“{highlight(r.sourceQuote, [r.brandModelHint])}”</> : <span className="muted small">연결된 원문 인용이 없습니다.</span>}
                                          <small>
                                            <span>씬 {s.sceneNo} 원문 중</span>
                                            {s.sourceText && <Button variant="ghost" size="sm" onClick={() => setDrawer(s)}>원문 보기</Button>}
                                          </small>
                                        </div>
                                      </td></tr>
                                    )}
                                  </Fragment>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {adding === s.id ? (
                            <DraftForm draft={draft} onChange={setDraft} onSave={() => addReq(s.id)} onCancel={() => setAdding(null)} busy={busy} saveLabel="추가" error={formError[s.id]} />
                          ) : (
                            <div className="add">
                              <Button variant="ghost" size="sm" onClick={() => { setAdding(s.id); setEditing(null); setDraft(emptyDraft(s.id)); }}>요구사항 추가</Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {data && analyzed && (
        <div className="bottombar">
          <div className="bottombar-inner">
            <span>{checkCount > 0 ? `확인 필요 ${checkCount}건이 남아 있습니다.` : '모든 항목을 확인했습니다.'}</span>
            <Button variant="primary" onClick={() => (checkCount > 0 ? setConfirmGo(true) : router.push(`/scripts/${id}/matching`))}>
              차량 매칭으로
            </Button>
          </div>
        </div>
      )}

      {drawer && (
        <aside className="drawer" aria-label={`씬 ${drawer.sceneNo} 원문`}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
            <h4 style={{ fontSize: 18 }}>씬 {drawer.sceneNo} 원문</h4>
            <Button variant="ghost" size="sm" aria-label="닫기" onClick={() => setDrawer(null)}>✕</Button>
          </div>
          <pre>{highlight(drawer.sourceText ?? '', drawer.requirements.map((r) => r.sourceQuote))}</pre>
        </aside>
      )}

      {confirmGo && (
        <ConfirmModal
          title={`확인하지 않은 항목이 ${checkCount}건 있습니다`}
          body="그대로 매칭해도 나중에 이 화면에서 고칠 수 있습니다."
          confirmLabel="그대로 매칭"
          cancelLabel="확인 필요 항목 보기"
          onConfirm={() => router.push(`/scripts/${id}/matching`)}
          onClose={() => { setConfirmGo(false); changeFilter('check'); }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="요구사항을 삭제합니다"
          body={`'${deleting.vehicleType}' 요구사항과 매칭 후보, 선택한 차량이 삭제됩니다.`}
          confirmLabel="삭제"
          danger
          busy={busy}
          onConfirm={() => removeReq(deleting)}
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  );
}
