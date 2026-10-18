import type { ButtonHTMLAttributes, ReactNode } from 'react';
import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-fill';
type Size = 'sm' | 'md' | 'lg';

const VARIANT_CLASS: Record<Variant, string> = {
  primary: 'pri',
  secondary: '',
  ghost: 'ghost',
  danger: 'danger',
  'danger-fill': 'danger-fill',
};

function cls(variant: Variant, size: Size, extra?: string) {
  return ['btn', VARIANT_CLASS[variant], size !== 'md' ? size : '', extra ?? ''].filter(Boolean).join(' ');
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', loading, disabled, className, children, ...rest }: ButtonProps) {
  return (
    <button type="button" {...rest} className={cls(variant, size, className)} disabled={disabled || loading}>
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = 'secondary',
  size = 'md',
  disabled,
  title,
  className,
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  if (disabled) {
    return (
      <span className={cls(variant, size, className)} aria-disabled="true" title={title}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={cls(variant, size, className)}>
      {children}
    </Link>
  );
}

export function Banner({
  tone = 'warn',
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'bad';
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`banner${tone === 'warn' ? '' : ` ${tone}`}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <span>
        {tone === 'info' ? 'ⓘ' : '⚠'} {children}
      </span>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {description && <p className="muted">{description}</p>}
      {action}
    </div>
  );
}

export function Skeletons({ count = 5 }: { count?: number }) {
  return (
    <div className="stack" aria-busy="true" aria-label="불러오는 중">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Banner
      tone="bad"
      action={
        <Button size="sm" onClick={onRetry}>
          다시 시도
        </Button>
      }
    >
      {message}
    </Banner>
  );
}

export const won = (n: number) => n.toLocaleString('ko-KR');
