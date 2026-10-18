// 태그·뱃지는 시안(mockups/index.html)과 같이 기호 + 텍스트로 표시한다.
import type { ReactElement, ReactNode } from 'react';
import type { QuoteStatus, Role, ScriptStatus, Usage } from '@/lib/types';
import {
  QUOTE_STATUS_LABEL,
  ROLE_LABEL,
  SCRIPT_STATUS_LABEL,
  USAGE_LABEL,
  confidenceLevel,
} from '@/lib/format';

export function StatusBadge({ status }: { status: ScriptStatus }) {
  const map: Record<ScriptStatus, [string, ReactNode]> = {
    UPLOADED: ['neutral', '◷'],
    ANALYZING: ['run', <span key="s" className="spinner" style={{ width: 12, height: 12 }} />],
    ANALYZED: ['ok', '✓'],
    FAILED: ['bad', '⚠'],
  };
  const [tone, icon] = map[status];
  return (
    <span className={`pill ${tone}`}>
      {icon} {SCRIPT_STATUS_LABEL[status]}
    </span>
  );
}

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  const map: Record<QuoteStatus, [string, string]> = {
    DRAFT: ['neutral', '✎'],
    REVIEW: ['warn', '◉'],
    SENT: ['run', '➤'],
    CONFIRMED: ['ok', '✓'],
  };
  const [tone, icon] = map[status];
  return (
    <span className={`pill ${tone}`}>
      {icon} {QUOTE_STATUS_LABEL[status]}
    </span>
  );
}

export function RoleTag({ role }: { role: Role }) {
  const map: Record<Role, [string, string]> = {
    LEAD: ['lead', '●'],
    SUPPORT: ['support', '◐'],
    BACKGROUND: ['bg', '○'],
  };
  const [cls, icon] = map[role];
  return (
    <span className={`pill ${cls}`}>
      {icon} {ROLE_LABEL[role]}
    </span>
  );
}

export function UsageTag({ usage }: { usage: Usage }) {
  if (usage === 'DAMAGE') return <span className="pill bad">✕ {USAGE_LABEL[usage]}</span>;
  const icon = { NORMAL: '▭', CHASE: '⚡', ACTION: '⚡' }[usage];
  return (
    <span className="pill use">
      {icon} {USAGE_LABEL[usage]}
    </span>
  );
}

export function DamageTag({ expected }: { expected: boolean }) {
  return expected ? <span className="pill bad">✕ 파손 예정</span> : <span className="pill neutral">아니오</span>;
}

export function Confidence({ value, edited }: { value: number | null; edited: boolean }) {
  if (edited) return <span className="pill run">✎ 수정함</span>;
  if (value === null) return <span className="faint">-</span>;
  const [cls, text] = {
    high: ['ok', '✓ 높음'],
    check: ['warn', '⚠ 확인 필요'],
    low: ['bad', '⚠ 낮음'],
  }[confidenceLevel(value)];
  return (
    <span className={`pill ${cls}`} title={`신뢰도 ${value.toFixed(2)}`}>
      {text}
    </span>
  );
}

export function PlateChip({ plateNo }: { plateNo: string | null | undefined }) {
  if (!plateNo) return <span className="plate none">번호 미정</span>;
  return (
    <span className="plate" aria-label={`차량 번호 ${plateNo}`}>
      {plateNo}
    </span>
  );
}

export function SceneNumber({ no, small, hidden }: { no: number; small?: boolean; hidden?: boolean }) {
  return (
    <span
      className={`scene-no${small ? ' sm' : ''}`}
      aria-label={hidden ? undefined : `씬 ${no}`}
      aria-hidden={hidden || undefined}
      style={hidden ? { visibility: 'hidden' } : undefined}
    >
      {no}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const s = Math.min(100, Math.max(0, score));
  return (
    <div className="score" aria-label={`일치 점수 ${score}점`}>
      <i style={{ '--s': `${s}%` } as React.CSSProperties} />
      <b>{score}</b>
    </div>
  );
}

/** 텍스트에서 marks 에 해당하는 구간을 형광펜(<mark>) 처리 */
export function highlight(text: string, marks: (string | null | undefined)[]): ReactNode[] {
  let parts: (string | ReactElement)[] = [text];
  marks.forEach((m, mi) => {
    if (!m) return;
    parts = parts.flatMap((p, pi): (string | ReactElement)[] => {
      if (typeof p !== 'string') return [p];
      const i = p.indexOf(m);
      if (i < 0) return [p];
      return [p.slice(0, i), <mark key={`${mi}-${pi}`}>{m}</mark>, p.slice(i + m.length)];
    });
  });
  return parts;
}
