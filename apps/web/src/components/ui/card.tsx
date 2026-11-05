import { cn } from './utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-4 pb-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold leading-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-xs text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4 pt-2', className)} {...props} />;
}

/** Dashboard KPI card: label, big number, small context line. */
export function KpiCard({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'profit' | 'loss' | 'default';
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn('p-4', onClick && 'cursor-pointer transition-colors hover:border-ring/50')}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 text-2xl font-bold tabular-nums tracking-tight',
          tone === 'profit' && 'text-profit',
          tone === 'loss' && 'text-loss',
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-2xs text-muted-foreground">{sub}</div> : null}
    </Card>
  );
}
