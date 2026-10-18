'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { quotes } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { fmtDate, QUOTE_STATUS_LABEL, QUOTE_STATUS_ORDER } from '@/lib/format';
import type { QuoteStatus } from '@/lib/types';
import { EmptyState, LinkButton, LoadError, Skeletons, won } from '@/components/ui';
import { QuoteStatusBadge } from '@/components/tags';

export default function QuotesPage() {
  const router = useRouter();
  const [status, setStatus] = useState<QuoteStatus | ''>('');
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const fetcher = useCallback(
    () => quotes.list({ status: status || undefined, q: debouncedQ || undefined, pageSize: 50 }),
    [status, debouncedQ],
  );
  const { data, error, loading, reload } = useLoad(fetcher);

  return (
    <div className="page">
      <div className="head">
        <h2>견적서</h2>
      </div>
      <div className="filters">
        {(['', ...QUOTE_STATUS_ORDER] as (QuoteStatus | '')[]).map((s) => (
          <button key={s || 'all'} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s ? QUOTE_STATUS_LABEL[s] : '전체'}
          </button>
        ))}
        <input className="inp" style={{ maxWidth: 280, marginLeft: 'auto', height: 32 }} placeholder="번호, 작품명, 제작사 검색" aria-label="견적서 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {error && <LoadError message="목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." onRetry={reload} />}
      {loading && !data && <Skeletons />}
      {data && data.items.length === 0 && (
        <div className="panel">
          <EmptyState
            title={status || debouncedQ ? '조건에 맞는 견적서가 없습니다' : '아직 만든 견적서가 없습니다'}
            description={status || debouncedQ ? undefined : '대본을 분석하고 차량을 매칭하면 견적서를 만들 수 있습니다.'}
            action={!status && !debouncedQ ? <LinkButton href="/scripts/new" variant="primary">새 대본 업로드</LinkButton> : undefined}
          />
        </div>
      )}
      {data && data.items.length > 0 && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead>
              <tr>
                <th>번호</th><th>작품명</th><th>제작사</th><th>버전</th><th>상태</th>
                <th className="num">항목</th><th className="num">합계</th><th>작성일</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((x) => (
                <tr key={x.id} className={`link${x.isLatest ? '' : ' old'}`} onClick={() => router.push(`/quotes/${x.id}`)}>
                  <td>
                    <Link href={`/quotes/${x.id}`} className="cell-link" onClick={(e) => e.stopPropagation()}>{x.quoteNo}</Link>
                  </td>
                  <td>{x.title}</td>
                  <td>{x.productionCompany}</td>
                  <td>v{x.version}{x.isLatest ? '' : ' (이전)'}</td>
                  <td><QuoteStatusBadge status={x.status} /></td>
                  <td className="num">{x.itemCount}{x.unassignedCount > 0 && <span className="caption" style={{ color: 'var(--warn-fg)' }}> (미정 {x.unassignedCount})</span>}</td>
                  <td className="num">{won(x.totalAmount)}원</td>
                  <td>{fmtDate(x.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
