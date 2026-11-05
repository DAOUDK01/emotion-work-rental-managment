import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Repeat } from 'lucide-react';
import { addMonths, todayInHelsinki } from '@emotionfix/shared';
import { api, qs } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, ErrorState, LoadingState } from '@/components/ui/misc';
import {
  customerLabel,
  paymentVariant,
  periodEnd,
  periodLabel,
  suggestPeriodText,
  type RentalRow,
  type RentalsResponse,
} from './types';
import { useGenerateNext } from './useGenerateNext';

interface SeriesItem {
  latest: RentalRow;
  periods: number;
  nextPeriod: string;
  due: boolean;
}

/** Upcoming / recurring: one card per recurring series, showing its latest period. */
export default function RecurringSection({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation('rentals');
  const generateNext = useGenerateNext();

  const recurring = useQuery({
    queryKey: ['rentals', 'list', 'recurring-active'],
    queryFn: () => api.get<RentalsResponse>('/rentals' + qs({ status: 'ACTIVE', pageSize: 200 })),
  });

  const series = useMemo<SeriesItem[]>(() => {
    const today = todayInHelsinki();
    const byRoot = new Map<number, RentalRow[]>();
    for (const r of recurring.data?.rentals ?? []) {
      if (!r.recurring) continue;
      const root = r.parentId ?? r.id;
      byRoot.set(root, [...(byRoot.get(root) ?? []), r]);
    }
    const items: SeriesItem[] = [];
    for (const rows of Array.from(byRoot.values())) {
      const latest = rows.reduce((a, b) => (b.startDate > a.startDate ? b : a));
      const nextStart = addMonths(latest.startDate, 1);
      const nextEnd = latest.endDate ? addMonths(latest.endDate, 1) : null;
      items.push({
        latest,
        periods: rows.length,
        nextPeriod: suggestPeriodText(nextStart, nextEnd),
        due: periodEnd(latest.startDate, latest.endDate) < today,
      });
    }
    // due first, then by the latest period's start
    return items.sort((a, b) =>
      a.due !== b.due ? (a.due ? -1 : 1) : a.latest.startDate.localeCompare(b.latest.startDate),
    );
  }, [recurring.data]);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-1.5">
            <Repeat className="h-4 w-4 text-muted-foreground" aria-hidden /> {t('recurring.title')}
          </CardTitle>
          <CardDescription>{t('recurring.description')}</CardDescription>
        </div>
        {series.length > 0 ? <Badge variant="outline">{t('recurring.count', { count: series.length })}</Badge> : null}
      </CardHeader>
      <CardContent>
        {recurring.isLoading ? (
          <LoadingState label={t('common:common.loading')} />
        ) : recurring.isError ? (
          <ErrorState error={recurring.error} onRetry={() => void recurring.refetch()} />
        ) : series.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {t('recurring.empty')}
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {series.map(({ latest, periods, nextPeriod, due }) => {
              const busy = generateNext.isPending && generateNext.variables === latest.id;
              return (
                <li key={latest.id} className="flex flex-col gap-2 rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{latest.unit.code}</p>
                      <p className="truncate text-xs text-muted-foreground">{customerLabel(latest)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span className="text-sm font-medium tabular-nums">{fmtEUR(latest.amountCents)}</span>
                      {due ? <Badge variant="danger">{t('recurring.due')}</Badge> : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{t('recurring.latest')}:</span>
                    <span className="font-medium">{periodLabel(latest)}</span>
                    <Badge variant={paymentVariant(latest.paymentStatus)}>
                      {latest.paymentStatus ? t(`common:status.${latest.paymentStatus}`) : t('table.noEntry')}
                    </Badge>
                  </div>
                  <p className="text-2xs text-muted-foreground">
                    {t('recurring.periods', { count: periods })}
                    {nextPeriod ? ` · ${t('recurring.next')}: ${nextPeriod}` : ''}
                  </p>
                  {canWrite ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-auto self-start"
                      disabled={busy}
                      onClick={() => generateNext.mutate(latest.id)}
                    >
                      <CalendarPlus className="h-3.5 w-3.5" aria-hidden />
                      {busy ? t('actions.generating') : t('actions.generateNext')}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
