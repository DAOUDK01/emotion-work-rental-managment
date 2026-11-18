import { cva, type VariantProps } from 'class-variance-authority';
import { FileSearch, RefreshCcw, TriangleAlert } from 'lucide-react';
import { cn } from './utils';
import { Button } from './button';
import { ApiError } from '@/lib/api';
import i18n from '@/lib/i18n';

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-semibold ring-1 ring-inset',
  {
    variants: {
      variant: {
        default: 'bg-secondary text-secondary-foreground ring-border/60',
        success: 'bg-profit/10 text-profit ring-profit/20',
        danger: 'bg-loss/10 text-loss ring-loss/20',
        warning: 'bg-warning/10 text-warning ring-warning/25',
        info: 'bg-info/10 text-info ring-info/20',
        outline: 'text-foreground ring-border',
        navy: 'bg-navy text-white ring-transparent dark:text-[hsl(var(--primary-foreground))]',
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
        'h-6 w-6 animate-spin rounded-full border-2 border-accent/25 border-t-accent',
        className,
      )}
      role="status"
      aria-label={i18n.t('common:common.loading')}
    />
  );
}

export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center gap-3 text-muted-foreground',
        className,
      )}
    >
      <Spinner />
      {label ? <p className="text-sm">{label}</p> : null}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
  icon: Icon = FileSearch,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-surface/40 p-8 text-center',
        className,
      )}
    >
      <span className="mb-1 inline-flex h-11 w-11 items-center justify-center rounded-full bg-card text-muted-foreground shadow-card ring-1 ring-border/70">
        <Icon className="h-5 w-5" />
      </span>
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
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-xl border border-destructive/25 bg-destructive/5 p-8 text-center">
      <span className="mb-1 inline-flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="h-5 w-5" />
      </span>
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
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[1.45rem] font-semibold leading-tight tracking-tight">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative overflow-hidden rounded-md bg-muted', className)}
      aria-hidden
    >
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-card/60 to-transparent" />
    </div>
  );
}

/** Segmented control (period buttons, model buttons — PDF look). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'default',
  className,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
  size?: 'default' | 'sm';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'inline-flex flex-wrap gap-0.5 rounded-lg border border-border/70 bg-muted/70 p-[3px]',
        className,
      )}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-md font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
              size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
              active
                ? 'bg-card text-foreground shadow-card ring-1 ring-border/60'
                : 'text-muted-foreground hover:bg-card/50 hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
