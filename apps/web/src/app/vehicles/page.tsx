'use client';

import { useCallback, useEffect, useState } from 'react';
import { vehicles } from '@/lib/api';
import { useLoad } from '@/lib/use-load';
import { CATEGORIES, CATEGORY_LABEL } from '@/lib/format';
import type { VehicleCategory, VehicleStatus } from '@/lib/types';
import { EmptyState, LoadError, Skeletons, won } from '@/components/ui';
import { PlateChip } from '@/components/tags';

const STATUS_LABEL: Record<VehicleStatus, [string, string]> = {
  AVAILABLE: ['ok', '✓ 운행 가능'],
  MAINTENANCE: ['warn', '⚠ 정비 중'],
  INACTIVE: ['neutral', '운행 중지'],
};

/** S-09 보유 차량 목록 (조회 전용. 등록/수정 S-10은 아직 없음) */
export default function VehiclesPage() {
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [category, setCategory] = useState<VehicleCategory | ''>('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  const fetcher = useCallback(
    () => vehicles.list({ q: debouncedQ || undefined, category: category || undefined, pageSize: 100 }),
    [debouncedQ, category],
  );
  const { data, error, loading, reload } = useLoad(fetcher);

  return (
    <div className="page">
      <div className="head">
        <div>
          <h2>보유 차량</h2>
          {data && <p className="sub"><span>전체 <b>{data.total}</b>대</span></p>}
        </div>
      </div>
      <div className="filters">
        <button className="chip" aria-pressed={category === ''} onClick={() => setCategory('')}>전체</button>
        {CATEGORIES.map((c) => (
          <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
            {CATEGORY_LABEL[c]}
          </button>
        ))}
        <input className="inp" style={{ maxWidth: 280, marginLeft: 'auto', height: 32 }} placeholder="번호, 차종, 색상 검색" aria-label="차량 검색" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <LoadError message="목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." onRetry={reload} />}
      {loading && !data && <Skeletons />}
      {data && data.items.length === 0 && <div className="panel"><EmptyState title="조건에 맞는 차량이 없습니다" /></div>}
      {data && data.items.length > 0 && (
        <div className="panel" style={{ overflowX: 'auto' }}>
          <table className="list">
            <thead>
              <tr><th>번호</th><th>차종</th><th className="num">연식</th><th>분류</th><th>색상</th><th className="num">일 단가</th><th>파손 촬영</th><th>상태</th></tr>
            </thead>
            <tbody>
              {data.items.map((v) => {
                const [tone, label] = STATUS_LABEL[v.status];
                return (
                  <tr key={v.id}>
                    <td><PlateChip plateNo={v.plateNo} /></td>
                    <td>{v.brand} {v.model}</td>
                    <td className="num">{v.year}</td>
                    <td>{CATEGORY_LABEL[v.category]}</td>
                    <td>{v.color ?? '-'}</td>
                    <td className="num">{won(v.dailyRate)}원</td>
                    <td>{v.damageAllowed ? '가능' : '불가'}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
