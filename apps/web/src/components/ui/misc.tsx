import { cva, type VariantProps } from 'class-variance-authority';
import { FileSearch, RefreshCcw, TriangleAlert } from 'lucide-react';
import { cn } from './utils';
import { Button } from './button';
import { ApiError } from '@/lib/api';
import i18n from '@/lib/i18n';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground',
        success: 'bg-profit/15 text-profit',
        danger: 'bg-loss/15 text-loss',
        warning: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
        info: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
        outline: 'border text-foreground',
        navy: 'bg-navy text-white',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent',
        className,
      )}
      role="status"
      aria-label={i18n.t('common:common.loading')}
    />
  );
}

export function LoadingState({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-3 text-muted-foreground">
      <Spinner />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <FileSearch className="h-8 w-8 text-muted-foreground/60" />
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-sm text-xs text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message =
    error instanceof ApiError
      ? error.message
      : error instanceof Error
        ? error.message
        : i18n.t('common:common.errorTitle');
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
      <TriangleAlert className="h-8 w-8 text-destructive/70" />
      <p className="text-sm font-medium">{message}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCcw className="h-3.5 w-3.5" /> {i18n.t('common:action.retry')}
        </Button>
      ) : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {description ? <p className="mt-0.5 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} />;
}

/** Segmented control (period buttons, model buttons — PDF look). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'default',
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: 'default' | 'sm';
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border bg-card p-1" role="tablist">
      {options.map((opt) => (
        <button
          key={String(opt.value)}
          type="button"
          role="tab"
          aria-selected={opt.value === value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            opt.value === value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
