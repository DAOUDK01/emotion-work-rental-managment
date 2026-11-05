import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/components/ui/utils';

export interface PreviewRow {
  key: string;
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  tone?: 'profit' | 'loss';
}

/** Live calculation card shown beside (desktop) or below (mobile) the entry forms. */
export function PreviewCard({
  title,
  description,
  rows,
  emptyText,
  children,
}: {
  title: string;
  description?: string;
  rows: PreviewRow[] | null;
  /** Shown instead of rows while the amount is still empty / invalid. */
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="lg:sticky lg:top-4">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {rows ? (
          <dl className="divide-y text-sm" aria-live="polite">
            {rows.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-3 py-1.5">
                <dt className={cn('text-muted-foreground', row.strong && 'font-medium text-foreground')}>{row.label}</dt>
                <dd
                  className={cn(
                    'tabular-nums',
                    row.strong && 'text-base font-bold',
                    row.muted && 'text-muted-foreground',
                    row.tone === 'profit' && 'text-profit',
                    row.tone === 'loss' && 'text-loss',
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="py-6 text-center text-xs text-muted-foreground">{emptyText}</p>
        )}
        {children}
      </CardContent>
    </Card>
  );
}
