'use client';

import { useEffect, useState } from 'react';
import { vehicles } from '@/lib/api';
import type { VehicleCategory, VehicleSummary } from '@/lib/types';

const p2 = (n: number) => String(n).padStart(2, '0');

/** 히어로 오른쪽 아래 흐르는 타임코드 (24fps) */
export function Timecode() {
  const [fr, setFr] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setFr((f) => f + 1), 1000 / 24);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor(fr / 24);
  return (
    <span className="hud br" aria-hidden="true">
      TC {p2(Math.floor(s / 3600))}:{p2(Math.floor(s / 60) % 60)}:{p2(s % 60)}:{p2(fr % 24)}
    </span>
  );
}

const FLEET: [VehicleCategory, string][] = [
  ['SEDAN', '세단'],
  ['SUV', 'SUV'],
  ['VAN', '승합'],
  ['TRUCK', '트럭'],
  ['SPORTS', '슈퍼카'],
  ['CLASSIC', '클래식'],
];

/** 보유 차량 분류별 대수 (GET /vehicles/summary) */
export function Fleet() {
  const [data, setData] = useState<VehicleSummary | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    vehicles.summary().then(setData).catch(() => setFailed(true));
  }, []);
  return (
    <>
      <div className="fleet">
        {FLEET.map(([k, label]) => (
          <div key={k}>
            <b>{data ? data.byCategory[k] : '-'}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {failed && <p className="caption faint" style={{ marginTop: 8 }}>보유 차량 대수를 불러오지 못했습니다.</p>}
      {data && <p className="caption faint" style={{ marginTop: 8 }}>운행 가능한 차량 {data.total}대 기준입니다.</p>}
    </>
  );
}
