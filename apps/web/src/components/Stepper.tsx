import { Fragment } from 'react';
import Link from 'next/link';

export type StepKey = 'analysis' | 'matching' | 'quote';

interface Props {
  scriptId: string;
  current: StepKey;
  /** 분석 완료 여부. 완료 전에는 모든 단계가 막힌다. */
  analyzed: boolean;
  /** 견적서가 있으면 그 id */
  quoteId?: string | null;
}

const ORDER: StepKey[] = ['analysis', 'matching', 'quote'];

/** 상단 바 아래 진행 단계 바 (시안 .steps) */
export function Stepper({ scriptId, current, analyzed, quoteId }: Props) {
  const ci = ORDER.indexOf(current);
  const steps = [
    { key: 'analysis', label: '분석 결과', href: analyzed ? `/scripts/${scriptId}/analysis` : null, hint: '분석이 끝나면 볼 수 있습니다' },
    { key: 'matching', label: '차량 매칭', href: analyzed ? `/scripts/${scriptId}/matching` : null, hint: '분석이 끝나면 볼 수 있습니다' },
    { key: 'quote', label: '견적서', href: quoteId ? `/quotes/${quoteId}` : null, hint: '차량 매칭에서 견적서를 만들면 볼 수 있습니다' },
  ] as const;
  return (
    <nav className="steps" aria-label="진행 단계">
      <div className="steps-inner">
        {steps.map((s, i) => {
          const done = i < ci;
          const label = done ? `✓ ${s.label}` : s.label;
          return (
            <Fragment key={s.key}>
              {i > 0 && <span className="sep" aria-hidden />}
              {s.key === current ? (
                <span className="step cur" aria-current="step">
                  {label}
                </span>
              ) : s.href ? (
                <Link href={s.href} className={`step${done ? ' done' : ''}`}>
                  {label}
                </Link>
              ) : (
                <span className="step off" aria-disabled="true" title={s.hint}>
                  {label}
                </span>
              )}
            </Fragment>
          );
        })}
      </div>
    </nav>
  );
}
