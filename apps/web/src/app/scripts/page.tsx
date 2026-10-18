'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { scripts } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { fmtDate, fmtPeriod, SCRIPT_STATUS_LABEL } from '@/lib/format';
import type { ScriptStatus } from '@/lib/types';
import { EmptyState, LinkButton, LoadError, Skeletons } from '@/components/ui';
import { StatusBadge } from '@/components/tags';

const FILTERS: (ScriptStatus | '')[] = ['', 'ANALYZING', 'ANALYZED', 'FAILED'];

export default function ScriptsPage() {
  const router = useRouter();
  const [status, setStatus] = useState<ScriptStatus | ''>('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const fetcher = useCallback(
    () => scripts.list({ status: status || undefined, q: debouncedQ || undefined, pageSize: 50 }),
    [status, debouncedQ],
  );
  const { data, error, loading, reload } = useLoad(fetcher);

  // 분석 중인 행이 있으면 주기적으로 갱신
  const hasRunning = data?.items.some((s) => s.status === 'ANALYZING' || s.status === 'UPLOADED');
  useEffect(() => {
    if (!hasRunning) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [hasRunning, reload]);

  const filtered = !!status || !!debouncedQ;

  return (
    <div className="page">
      <div className="head">
        <h2>대본</h2>
        <LinkButton href="/scripts/new" variant="primary">
          새 대본 업로드
        </LinkButton>
      </div>

      <div className="filters">
        {FILTERS.map((f) => (
          <button key={f || 'all'} className="chip" aria-pressed={status === f} onClick={() => setStatus(f)}>
            {f ? SCRIPT_STATUS_LABEL[f] : '전체'}
          </button>
        ))}
        <input
          className="inp"
          style={{ maxWidth: 280, marginLeft: 'auto', height: 32 }}
          placeholder="작품명, 제작사 검색"
          aria-label="대본 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {error && <LoadError message="목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." onRetry={reload} />}
      {loading && !data && <Skeletons />}
      {data && data.items.length === 0 && (
        <div className="panel">
          {filtered ? (
            <EmptyState title="조건에 맞는 대본이 없습니다" />
          ) : (
            <EmptyState
              title="아직 업로드한 대본이 없습니다"
              description="대본을 올리면 씬별로 필요한 차량을 정리해 드립니다."
              action={
                <LinkButton href="/scripts/new" variant="primary">
                  새 대본 업로드
                </LinkButton>
              }
            />
          )}
        </div>
      )}
      {data && data.items.length > 0 && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead>
              <tr>
                <th>작품명</th>
                <th>제작사</th>
                <th>촬영 예정</th>
                <th>상태</th>
                <th className="num">씬</th>
                <th className="num">차량 요구</th>
                <th>업로드일</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((s) => (
                <tr key={s.id} className="link" onClick={() => router.push(`/scripts/${s.id}`)}>
                  <td>
                    <Link href={`/scripts/${s.id}`} className="cell-link" onClick={(e) => e.stopPropagation()}>
                      {s.title}
                    </Link>
                  </td>
                  <td>{s.productionCompany}</td>
                  <td>{s.shootStart ? fmtPeriod(s.shootStart, s.shootEnd) : '-'}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td className="num">{s.sceneCount}</td>
                  <td className="num">{s.requirementCount}</td>
                  <td>{fmtDate(s.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
