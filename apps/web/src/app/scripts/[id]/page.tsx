'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { analysis as analysisApi, quotes, scripts } from '@/lib/api';
import type { Analysis, QuoteListItem, Script } from '@/lib/types';
import { confidenceLevel, fmtBytes, fmtDate, fmtPeriod } from '@/lib/format';
import { useLoad } from '@/lib/use-load';
import { Banner, Button, LinkButton, LoadError, Skeletons } from '@/components/ui';
import { StatusBadge } from '@/components/tags';
import { ConfirmModal } from '@/components/Modal';
import { useToast } from '@/components/Toast';

export default function ScriptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();

  const fetcher = useCallback(() => scripts.get(id), [id]);
  const { data: script, error, loading, reload, setData } = useLoad<Script>(fetcher);

  const [result, setResult] = useState<Analysis | null>(null);
  const [latestQuote, setLatestQuote] = useState<QuoteListItem | null>(null);
  const [confirm, setConfirm] = useState<'reanalyze' | 'delete' | null>(null);
  const [busy, setBusy] = useState(false);

  const status = script?.status;

  // 분석 중이면 3초 간격 폴링, ANALYZED/FAILED 에서 멈춘다.
  useEffect(() => {
    if (status !== 'ANALYZING' && status !== 'UPLOADED') return;
    const t = setInterval(() => {
      scripts.get(id).then(setData).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [status, id, setData]);

  // 완료되면 요약(확인 필요 건수 등)과 견적서 유무를 가져온다.
  useEffect(() => {
    if (status !== 'ANALYZED') return;
    let alive = true;
    analysisApi.get(id).then((a) => alive && setResult(a)).catch(() => {});
    quotes
      .list({ scriptId: id, pageSize: 20 })
      .then((p) => alive && setLatestQuote(p.items.find((q) => q.isLatest) ?? p.items[0] ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [status, id]);

  const stats = useMemo(() => {
    if (!result) return null;
    const reqs = result.scenes.flatMap((s) => s.requirements);
    return {
      edited: reqs.filter((r) => r.isUserEdited).length,
      needCheck: reqs.filter((r) => !r.isUserEdited && r.confidence !== null && confidenceLevel(r.confidence) !== 'high').length,
    };
  }, [result]);

  async function reanalyze() {
    setBusy(true);
    try {
      const s = await scripts.reanalyze(id);
      setData(s);
      setResult(null);
      setConfirm(null);
      toast('다시 분석을 시작했습니다.');
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await scripts.remove(id);
      toast('삭제했습니다.');
      router.push('/scripts');
    } catch (e) {
      setBusy(false);
      setConfirm(null);
      toast((e as Error).message, { error: true });
    }
  }

  if (loading && !script) return <div className="page"><Skeletons count={4} /></div>;
  if (error || !script) return <div className="page"><LoadError message={error ?? '대본을 불러오지 못했습니다.'} onRetry={reload} /></div>;

  const running = script.status === 'ANALYZING' || script.status === 'UPLOADED';
  const analyzed = script.status === 'ANALYZED';

  return (
    <div className="page">
      <div className="crumb">
        <Link href="/scripts">대본 목록</Link> &gt; {script.title}
      </div>
      <div className="head">
        <div>
          <div className="row">
            <h2>{script.title}</h2>
            <StatusBadge status={script.status} />
          </div>
          <p className="sub">
            <span>제작사 <b>{script.productionCompany}</b></span>
            <span>촬영 예정 <b>{script.shootStart ? fmtPeriod(script.shootStart, script.shootEnd) : '-'}</b></span>
            <span>업로드 <b>{fmtDate(script.createdAt)}</b></span>
            <span style={{ overflowWrap: 'anywhere' }}>파일 <b>{script.fileName} ({fmtBytes(script.fileSize)})</b></span>
          </p>
        </div>
        <div className="act">
          <Button disabled={running} onClick={() => setConfirm('reanalyze')} title={running ? '분석이 끝나면 다시 분석할 수 있습니다' : undefined}>
            재분석
          </Button>
          <Button variant="danger" disabled={script.status === 'ANALYZING'} onClick={() => setConfirm('delete')}>
            삭제
          </Button>
        </div>
      </div>

      {running && (
        <section className="panel stack" style={{ padding: 24 }} aria-live="polite">
          <div className="row">
            <span className="spinner" style={{ color: 'var(--brand-text)' }} aria-hidden />
            <h4 style={{ fontSize: 18 }}>분석 중입니다</h4>
          </div>
          <div className="progress" aria-hidden>
            <i />
          </div>
          <p className="muted">대본에서 씬을 나누고 차량 요구사항을 찾는 중입니다. 다른 화면으로 이동해도 분석은 계속됩니다.</p>
        </section>
      )}

      {script.status === 'FAILED' && (
        <Banner
          tone="bad"
          action={<Button size="sm" onClick={() => setConfirm('reanalyze')}>재분석</Button>}
        >
          분석에 실패했습니다. 대본 파일에 문제가 없는지 확인하고 다시 분석해 주세요.
          {script.errorMessage ? ` (${script.errorMessage})` : ''}
        </Banner>
      )}

      {analyzed && (
        <section className="stack" style={{ gap: 24 }}>
          <div className="stats">
            <div className="stat"><b>{script.sceneCount}</b><span>씬</span></div>
            <div className="stat"><b>{script.requirementCount}</b><span>차량 요구</span></div>
            <div className="stat"><b>{stats ? stats.needCheck : '-'}</b><span>확인 필요</span></div>
          </div>
          <div className="row">
            <LinkButton href={`/scripts/${id}/analysis`} variant="primary">분석 결과 보기</LinkButton>
            {latestQuote && <LinkButton href={`/quotes/${latestQuote.id}`}>견적서 보기</LinkButton>}
          </div>
          {script.analysisModel && (
            <p className="caption faint">분석 모델 {script.analysisModel} · 프롬프트 {script.promptVersion}</p>
          )}
        </section>
      )}

      {!analyzed && (
        <div className="row" style={{ marginTop: 24 }}>
          <LinkButton href={`/scripts/${id}/analysis`} variant="primary" disabled title="분석이 끝나면 볼 수 있습니다">
            분석 결과 보기
          </LinkButton>
          <span className="small muted">{running ? '분석이 끝나면 볼 수 있습니다.' : ''}</span>
        </div>
      )}

      {confirm === 'reanalyze' && (
        <ConfirmModal
          title="다시 분석합니다"
          body={
            stats && stats.edited > 0
              ? `지금까지 수정한 내용 ${stats.edited}건이 사라지고 선택한 차량도 초기화됩니다.`
              : '기존 분석 결과와 매칭 후보가 지워지고 다시 만들어집니다.'
          }
          confirmLabel="다시 분석"
          danger
          busy={busy}
          onConfirm={reanalyze}
          onClose={() => setConfirm(null)}
        />
      )}
      {confirm === 'delete' && (
        <ConfirmModal
          title="대본을 삭제합니다"
          body={`대본 '${script.title}' 원본과 분석 결과가 모두 삭제됩니다. 이미 만든 견적서는 유지됩니다. 되돌릴 수 없습니다.`}
          confirmLabel="삭제"
          danger
          busy={busy}
          onConfirm={remove}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
