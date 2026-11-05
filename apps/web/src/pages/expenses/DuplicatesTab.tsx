import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Copy } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { VoidReasonDialog } from './VoidReasonDialog';
import {
  categoryLabel,
  errorMessage,
  type DuplicateCluster,
  type DuplicateClusterExpense,
  type DuplicateClusters,
  type Lookups,
} from './types';

interface VoidTarget {
  row: DuplicateClusterExpense;
  cluster: DuplicateCluster;
}

/**
 * SUSPECTED DUPLICATES tab — GET /expenses/duplicates clusters (same vendor + amount, dates within
 * 3 days) as cards with per-row Void: the clean-up workflow for the Excel import's double entries.
 */
export function DuplicatesTab({ lookups, canWrite }: { lookups: Lookups; canWrite: boolean }) {
  const { t, i18n } = useTranslation('expenses');
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const [voiding, setVoiding] = useState<VoidTarget | null>(null);

  const groups = useQuery({
    queryKey: ['expenses', 'duplicates'],
    queryFn: () => api.get<DuplicateClusters>('/expenses/duplicates'),
  });

  const voidExpense = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api.post<unknown>(`/expenses/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success(t('common:common.voidedOk'));
      setVoiding(null);
      for (const key of ['expenses', 'dashboard', 'vat', 'investments', 'partners', 'products', 'stock']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const categoryName = (c: { id: number; nameEn: string }) => {
    const full = lookups.expenseCategories.find((x) => x.id === c.id);
    return categoryLabel(full ?? c, lang);
  };

  if (groups.isLoading) return <LoadingState label={t('common:common.loading')} />;
  if (groups.isError) return <ErrorState error={groups.error} onRetry={() => void groups.refetch()} />;
  const data = groups.data;
  if (!data || data.groups.length === 0) {
    return <EmptyState title={t('duplicatesTab.emptyTitle')} hint={t('duplicatesTab.emptyHint')} />;
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('duplicatesTab.intro', { count: data.total })}</p>
      <div className="grid gap-3 lg:grid-cols-2">
        {data.groups.map((g) => {
          const keyId = g.expenses.map((e) => e.id).join('-');
          return (
            <Card key={keyId}>
              <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2">
                    <Copy className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    <span className="truncate">{g.vendor ?? '–'}</span>
                  </CardTitle>
                  <CardDescription>{t('duplicatesTab.entries', { count: g.count })}</CardDescription>
                </div>
                <span className="text-lg font-bold tabular-nums">{fmtEUR(g.grossCents)}</span>
              </CardHeader>
              <CardContent>
                <ul className="divide-y rounded-md border">
                  {g.expenses.map((e, idx) => (
                    <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium tabular-nums">#{e.id}</span>
                          <span className="whitespace-nowrap text-muted-foreground">
                            {e.expenseDate ? fmtDate(e.expenseDate) : <Badge variant="warning">{t('table.noDate')}</Badge>}
                          </span>
                          {idx === 0 ? <Badge variant="info">{t('duplicatesTab.earliest')}</Badge> : null}
                        </div>
                        <div className="truncate">{e.description}</div>
                        <div className="text-2xs text-muted-foreground">{categoryName(e.category)}</div>
                      </div>
                      {canWrite ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setVoiding({ row: e, cluster: g })}
                          aria-label={t('duplicatesTab.voidOne', { id: e.id })}
                        >
                          <Ban className="h-3.5 w-3.5" /> {t('common:action.void')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {t('duplicatesTab.footer')}
      </p>

      <VoidReasonDialog
        open={voiding !== null}
        title={t('void.expenseTitle')}
        message={
          voiding
            ? t('void.duplicateMessage', {
                id: voiding.row.id,
                description: voiding.row.description,
                amount: fmtEUR(voiding.row.grossCents),
              })
            : ''
        }
        defaultReason={
          voiding
            ? t('duplicatesTab.defaultReason', {
                ids: voiding.cluster.expenses
                  .filter((x) => x.id !== voiding.row.id)
                  .map((x) => `#${x.id}`)
                  .join(', '),
              })
            : ''
        }
        busy={voidExpense.isPending}
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => voiding && voidExpense.mutate({ id: voiding.row.id, reason })}
      />
    </div>
  );
}
