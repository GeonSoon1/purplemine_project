'use client';

import { useCallback, useEffect, useState } from 'react';
import { vehicles } from '@/lib/api';
import type { Vehicle, VehicleCategory } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, vehicleName } from '@/lib/format';
import { Modal } from './Modal';
import { Banner, Button, Skeletons, won } from './ui';
import { PlateChip } from './tags';

/** 전체 보유 차량에서 한 대를 고르는 모달 (S-06 [다른 차량 찾기], S-07 [차량 선택]·[항목 추가] 공용) */
export function VehiclePicker({
  busy,
  onPick,
  onClose,
}: {
  busy?: boolean;
  onPick: (v: Vehicle) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<VehicleCategory | ''>('');
  const [damageOnly, setDamageOnly] = useState(false);
  const [items, setItems] = useState<Vehicle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const search = useCallback(async () => {
    try {
      const page = await vehicles.list({
        q: q.trim() || undefined,
        category: category || undefined,
        damageAllowed: damageOnly ? true : undefined,
        status: 'AVAILABLE',
        pageSize: 100,
      });
      setItems(page.items);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [q, category, damageOnly]);

  useEffect(() => {
    const t = setTimeout(search, 250);
    return () => clearTimeout(t);
  }, [search]);

  const chosen = items?.find((v) => v.id === selected);

  return (
    <Modal
      title="차량 선택"
      size="lg"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button variant="primary" disabled={!chosen} loading={busy} onClick={() => chosen && onPick(chosen)}>
            이 차량 선택
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="filters" style={{ marginBottom: 0 }}>
          <input className="inp" style={{ flex: 1, minWidth: 180 }} placeholder="차종, 번호, 색상 검색" aria-label="차량 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="inp" style={{ width: 130 }} aria-label="분류" value={category} onChange={(e) => setCategory(e.target.value as VehicleCategory | '')}>
            <option value="">전체 분류</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <label className="row small">
            <input type="checkbox" checked={damageOnly} onChange={(e) => setDamageOnly(e.target.checked)} />
            파손 촬영 가능만
          </label>
        </div>
        {error && <Banner tone="bad">{error}</Banner>}
        {!items && !error && <Skeletons count={4} />}
        {items && items.length === 0 && <p className="muted">조건에 맞는 보유 차량이 없습니다.</p>}
        {items && items.length > 0 && (
          <div className="panel pick-table">
            <table className="list">
              <thead>
                <tr>
                  <th />
                  <th>번호</th>
                  <th>차종</th>
                  <th>분류</th>
                  <th className="num">일 단가</th>
                  <th>파손 촬영</th>
                </tr>
              </thead>
              <tbody>
                {items.map((v) => (
                  <tr key={v.id} className={`link${v.id === selected ? ' on' : ''}`} onClick={() => setSelected(v.id)}>
                    <td>
                      <input type="radio" name="vehicle" checked={v.id === selected} onChange={() => setSelected(v.id)} aria-label={`${vehicleName(v)} ${v.plateNo} 선택`} />
                    </td>
                    <td>
                      <PlateChip plateNo={v.plateNo} />
                    </td>
                    <td>{vehicleName(v)}</td>
                    <td>{CATEGORY_LABEL[v.category]}</td>
                    <td className="num">{won(v.dailyRate)}원</td>
                    <td>{v.damageAllowed ? '가능' : '불가'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
