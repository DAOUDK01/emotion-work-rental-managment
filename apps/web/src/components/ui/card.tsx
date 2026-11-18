import { cn } from './utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-card text-card-foreground shadow-card',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn('text-[0.94rem] font-semibold leading-tight tracking-tight', className)}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-2', className)} {...props} />;
}

/** Colour accents shared by KPI tiles and section icons (token-based, so dark mode works). */
export type Accent = 'navy' | 'teal' | 'violet' | 'amber' | 'sky' | 'rose' | 'profit' | 'loss';

export const ACCENT_CHIP: Record<Accent, string> = {
  navy: 'bg-chart-1/10 text-chart-1 ring-chart-1/15',
  teal: 'bg-chart-2/10 text-chart-2 ring-chart-2/20',
  violet: 'bg-chart-3/10 text-chart-3 ring-chart-3/20',
  amber: 'bg-chart-4/10 text-chart-4 ring-chart-4/20',
  sky: 'bg-chart-5/10 text-chart-5 ring-chart-5/20',
  rose: 'bg-chart-6/10 text-chart-6 ring-chart-6/20',
  profit: 'bg-profit/10 text-profit ring-profit/20',
  loss: 'bg-loss/10 text-loss ring-loss/20',
};

const ACCENT_BAR: Record<Accent, string> = {
  navy: 'from-chart-1/70',
  teal: 'from-chart-2/70',
  violet: 'from-chart-3/70',
  amber: 'from-chart-4/70',
  sky: 'from-chart-5/70',
  rose: 'from-chart-6/70',
  profit: 'from-profit/70',
  loss: 'from-loss/70',
};

/** Small tinted square holding a section / KPI icon. */
export function IconChip({
  icon: Icon,
  accent = 'navy',
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent?: Accent;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset',
        ACCENT_CHIP[accent],
        className,
      )}
    >
      <Icon className="h-[1.1rem] w-[1.1rem]" />
    </span>
  );
}

/** Dashboard KPI tile: label, big number, small context line, optional icon + accent. */
export function KpiCard({
  label,
  value,
  sub,
  tone,
  onClick,
  icon,
  accent,
  className,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  tone?: 'profit' | 'loss' | 'default';
  onClick?: () => void;
  icon?: React.ComponentType<{ className?: string }>;
  accent?: Accent;
  className?: string;
}) {
  const a: Accent = accent ?? (tone === 'profit' ? 'profit' : tone === 'loss' ? 'loss' : 'navy');
  return (
    <Card
      className={cn(
        'group relative overflow-hidden p-4 sm:p-5',
        onClick &&
          'cursor-pointer transition-[box-shadow,transform,border-color] hover:-translate-y-0.5 hover:border-ring/40 hover:shadow-elevated',
        className,
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      {/* thin accent line along the top edge */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r to-transparent opacity-80',
          ACCENT_BAR[a],
        )}
      />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-[0.8rem] font-medium leading-snug text-muted-foreground">
          {label}
        </div>
        {icon ? <IconChip icon={icon} accent={a} className="-mr-1 -mt-1 h-8 w-8" /> : null}
      </div>
      <div
        className={cn(
          'mt-2 truncate text-[1.6rem] font-semibold leading-none tracking-tight tabular-nums',
          tone === 'profit' && 'text-profit',
          tone === 'loss' && 'text-loss',
        )}
        title={value}
      >
        {value}
      </div>
      {sub ? <div className="mt-2 text-xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}
