import { HandCoins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, IconChip, type Accent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import { fmtDate, fmtEUR } from '@/lib/format';

/** Card with an icon chip, title, description and optional right-hand controls. */
export function ChartCard({
  icon,
  accent = 'navy',
  title,
  description,
  actions,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent?: Accent;
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-1 pt-5">
        <div className="flex min-w-0 items-start gap-3">
          <IconChip icon={icon} accent={accent} />
          <div className="min-w-0 pt-0.5">
            <h3 className="text-[0.94rem] font-semibold leading-tight tracking-tight">{title}</h3>
            {description ? (
              <p className="mt-1 text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <CardContent className="flex-1 pt-3">{children}</CardContent>
    </Card>
  );
}

/** Small uppercase heading that separates dashboard sections. */
export function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <h2 className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {children}
      </h2>
      <span aria-hidden className="h-px flex-1 bg-border/80" />
      {aside}
    </div>
  );
}

/** One grouped alert for partners/cash boxes holding company money too long. */
export function CashAlerts({
  items,
}: {
  items: Array<{ id: number; name: string; holdingCents: number; oldestUnsettledDate: string | null }>;
}) {
  const { t } = useTranslation('dashboard');
  if (items.length === 0) return null;
  return (
    <div
      className="overflow-hidden rounded-xl border border-warning/30 bg-warning/[0.06] shadow-xs"
      role="alert"
    >
      <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
        <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <HandCoins className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {t('alerts.title', { count: items.length })}
          </p>
          <ul className="mt-1.5 space-y-1">
            {items.map((b) => (
              <li key={b.id} className="flex items-start gap-2 text-xs text-foreground/80">
                <span aria-hidden className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-warning" />
                <span>
                  {t('alerts.cashHolding', {
                    name: b.name,
                    amount: fmtEUR(b.holdingCents),
                    date: fmtDate(b.oldestUnsettledDate),
                  })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Rental payback progress bar (unit performance table). */
export function PaybackBar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent"
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs font-medium tabular-nums">{pct} %</span>
    </div>
  );
}

/** Placeholder layout shown while the summary loads. */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-4 h-7 w-28" />
            <Skeleton className="mt-3 h-3 w-16" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="space-y-2">
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            <div className="mt-6 space-y-4">
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-7/12" />
              <Skeleton className="h-4 w-4/12" />
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-5">
        <Skeleton className="h-3.5 w-40" />
        <div className="mt-6 flex h-48 items-end gap-6 px-4">
          {[55, 80, 40, 95, 65, 75].map((h, i) => (
            <div key={i} className="flex-1" style={{ height: `${h}%` }}>
              <Skeleton className="h-full w-full rounded-t-lg" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
