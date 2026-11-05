import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RefreshCcw } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { modelLabel, statusBadgeVariant, type EntryListItem } from './types';

const LATEST_QS = qs({ page: 1, pageSize: 10 });

/** "Latest entries" — last 10 income rows (GET /entries), refreshed after every save via ['entries']. */
export function LatestEntries() {
  const { t, i18n } = useTranslation('entry');
  const lang = i18n.language;
  const entries = useQuery({
    queryKey: ['entries', 'list', LATEST_QS],
    queryFn: () => api.get<{ entries: EntryListItem[]; total: number }>('/entries' + LATEST_QS),
  });

  const rows = entries.data?.entries ?? [];

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{t('latest.title')}</CardTitle>
          <CardDescription>{t('latest.subtitle')}</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void entries.refetch()}
          disabled={entries.isFetching}
          aria-label={t('common:action.refresh')}
        >
          <RefreshCcw className={cn('h-3.5 w-3.5', entries.isFetching && 'animate-spin')} />
          <span className="hidden sm:inline">{t('common:action.refresh')}</span>
        </Button>
      </CardHeader>
      <CardContent>
        {entries.isLoading ? (
          <LoadingState label={t('common:common.loading')} />
        ) : entries.isError ? (
          <ErrorState error={entries.error} onRetry={() => void entries.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title={t('latest.emptyTitle')} hint={t('latest.emptyHint')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('common:common.date')}</TH>
                <TH className="hidden sm:table-cell">{t('table.type')}</TH>
                <TH>{t('fields.description')}</TH>
                <TH className="text-right">{t('table.gross')}</TH>
                <TH>{t('common:common.status')}</TH>
                <TH className="hidden md:table-cell">{t('common:money.receivedBy')}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((e) => {
                const voided = e.status === 'VOID';
                const who = e.customer?.name ?? e.customerName;
                const detail = [e.unit?.code, who].filter(Boolean).join(' · ');
                return (
                  <TR key={e.id} className={voided ? 'text-muted-foreground' : undefined}>
                    <TD className="whitespace-nowrap">{fmtDate(e.entryDate)}</TD>
                    <TD className="hidden sm:table-cell">{modelLabel(e.model, lang)}</TD>
                    <TD className="max-w-[16rem]">
                      <div className={cn('truncate', voided && 'line-through')}>
                        {e.description || detail || <span className="text-muted-foreground">–</span>}
                      </div>
                      {e.description && detail ? <div className="truncate text-2xs text-muted-foreground">{detail}</div> : null}
                      <div className="text-2xs text-muted-foreground sm:hidden">{modelLabel(e.model, lang)}</div>
                    </TD>
                    <TDMoney className={cn('whitespace-nowrap', voided && 'line-through')}>{fmtEUR(e.grossCents)}</TDMoney>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1">
                        {voided ? (
                          <Badge variant="danger">{t('common:status.VOID')}</Badge>
                        ) : (
                          <Badge variant={statusBadgeVariant(e.paymentStatus)}>{t(`common:status.${e.paymentStatus}`)}</Badge>
                        )}
                        {e.needsReview ? (
                          <Badge variant="warning" title={e.reviewReason ?? undefined}>
                            {t('common:common.needsReview')}
                          </Badge>
                        ) : null}
                        {!e.vatInvoice && !voided ? (
                          <Badge variant="outline" title={t('latest.noVatInvoiceTitle')}>
                            {t('latest.noVatInvoice')}
                          </Badge>
                        ) : null}
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">{e.receivedBy?.name ?? '–'}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
