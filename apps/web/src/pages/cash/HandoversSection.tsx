import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorState, LoadingState, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { Pager, VoidReasonDialog } from './CashWidgets';
import { errorMessage, PAGE_SIZE, type Handover, type HandoversResponse, type HandoverStatus } from './types';

/** Handover history with Void (reason required, always confirmed). */
export function HandoversSection({ canWrite, onRecord }: { canWrite: boolean; onRecord?: () => void }) {
  const { t } = useTranslation('cash');
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'' | HandoverStatus>('');
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<Handover | null>(null);

  const listQs = useMemo(() => qs({ status: status || undefined, page, pageSize: PAGE_SIZE }), [status, page]);
  const handovers = useQuery({
    queryKey: ['cash', 'handovers', listQs],
    queryFn: () => api.get<HandoversResponse>('/cash/handovers' + listQs),
    placeholderData: (prev) => prev,
  });

  const voidMutation = useMutation({
    mutationFn: (v: { id: number; reason: string }) =>
      api.post<{ handover: Handover }>(`/cash/handovers/${v.id}/void`, { reason: v.reason }),
    onSuccess: () => {
      toast.success(t('common:common.voidedOk'));
      void queryClient.invalidateQueries({ queryKey: ['cash'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['partners'] });
      setVoiding(null);
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>{t('history.title')}</CardTitle>
          <CardDescription>{t('history.description')}</CardDescription>
        </div>
        <Segmented
          size="sm"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '' as const, label: t('common:common.all') },
            { value: 'ACTIVE' as const, label: t('common:status.ACTIVE') },
            { value: 'VOID' as const, label: t('common:status.VOID') },
          ]}
        />
      </CardHeader>
      <CardContent>
        {handovers.isLoading ? (
          <LoadingState label={t('common:common.loading')} />
        ) : handovers.isError ? (
          <ErrorState error={handovers.error} onRetry={() => void handovers.refetch()} />
        ) : !handovers.data || handovers.data.handovers.length === 0 ? (
          <EmptyState
            title={status ? t('history.emptyFilteredTitle') : t('history.emptyTitle')}
            hint={t('history.emptyHint')}
            action={
              canWrite && onRecord && !status ? (
                <Button size="sm" onClick={onRecord}>
                  {t('history.recordFirst')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={cn(handovers.isFetching && 'opacity-70 transition-opacity')} aria-busy={handovers.isFetching}>
            <Table>
              <THead>
                <TR>
                  <TH>{t('common:common.date')}</TH>
                  <TH>{t('history.from')}</TH>
                  <TH>{t('history.to')}</TH>
                  <TH className="text-right">{t('history.amount')}</TH>
                  <TH>{t('history.note')}</TH>
                  <TH>{t('common:common.status')}</TH>
                  {canWrite ? <TH className="text-right">{t('common:common.actions')}</TH> : null}
                </TR>
              </THead>
              <TBody>
                {handovers.data.handovers.map((h) => {
                  const isVoid = h.status === 'VOID';
                  return (
                    <TR key={h.id} className={cn(isVoid && 'text-muted-foreground')}>
                      <TD className="whitespace-nowrap tabular-nums">{fmtDate(h.date)}</TD>
                      <TD className="whitespace-nowrap font-medium">{h.fromHolder.name}</TD>
                      <TD className="whitespace-nowrap">{h.toHolder.name}</TD>
                      <TDMoney className={cn('whitespace-nowrap font-medium', isVoid && 'line-through')}>
                        {fmtEUR(h.amountCents)}
                      </TDMoney>
                      <TD className="min-w-[10rem]">{h.note ?? '–'}</TD>
                      <TD>
                        <Badge variant={isVoid ? 'danger' : 'success'}>{t(`common:status.${h.status}`)}</Badge>
                      </TD>
                      {canWrite ? (
                        <TD className="text-right">
                          {!isVoid ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setVoiding(h)}
                              aria-label={t('history.voidAria', {
                                amount: fmtEUR(h.amountCents),
                                from: h.fromHolder.name,
                                date: fmtDate(h.date),
                              })}
                            >
                              <Ban className="h-3.5 w-3.5" aria-hidden="true" /> {t('common:action.void')}
                            </Button>
                          ) : null}
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <Pager page={page} pageSize={PAGE_SIZE} total={handovers.data.total} onPage={setPage} />
          </div>
        )}
      </CardContent>

      <VoidReasonDialog
        open={voiding !== null}
        title={t('void.title')}
        message={
          voiding
            ? t('void.message', {
                amount: fmtEUR(voiding.amountCents),
                from: voiding.fromHolder.name,
                to: voiding.toHolder.name,
                date: fmtDate(voiding.date),
              })
            : ''
        }
        busy={voidMutation.isPending}
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => {
          if (voiding) voidMutation.mutate({ id: voiding.id, reason });
        }}
      />
    </Card>
  );
}
