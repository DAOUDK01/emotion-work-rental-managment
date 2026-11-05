import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { LedgerKindBadge, Pager } from './CashWidgets';
import { PAGE_SIZE, signedLedgerAmount, type HolderRef, type LedgerResponse } from './types';

/** Merged receipts + handovers ledger, filterable by holder and date range. */
export function LedgerSection({ holders }: { holders: HolderRef[] }) {
  const { t } = useTranslation('cash');
  const [holderId, setHolderId] = useState(0);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const ledgerQs = useMemo(
    () => qs({ holderId: holderId || undefined, from, to, page, pageSize: PAGE_SIZE }),
    [holderId, from, to, page],
  );
  const ledger = useQuery({
    queryKey: ['cash', 'ledger', ledgerQs],
    queryFn: () => api.get<LedgerResponse>('/cash/ledger' + ledgerQs),
    placeholderData: (prev) => prev,
  });

  const filtered = holderId !== 0 || from !== '' || to !== '';
  const clearFilters = () => {
    setHolderId(0);
    setFrom('');
    setTo('');
    setPage(1);
  };
  const selectedHolder = holders.find((h) => h.id === holderId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('ledger.title')}</CardTitle>
        <CardDescription>
          {selectedHolder ? t('ledger.descriptionHolder', { name: selectedHolder.name }) : t('ledger.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="w-full space-y-1.5 sm:w-48">
            <Label htmlFor="cash-ledger-holder">{t('ledger.holder')}</Label>
            <Select
              id="cash-ledger-holder"
              className="h-8 text-xs"
              value={holderId}
              onChange={(e) => {
                setHolderId(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value={0}>{t('ledger.allHolders')}</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cash-ledger-from">{t('common:period.from')}</Label>
            <Input
              id="cash-ledger-from"
              type="date"
              className="h-8 w-36 text-xs"
              value={from}
              max={to || undefined}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cash-ledger-to">{t('common:period.to')}</Label>
            <Input
              id="cash-ledger-to"
              type="date"
              className="h-8 w-36 text-xs"
              value={to}
              min={from || undefined}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </div>
          {filtered ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" aria-hidden="true" /> {t('ledger.clearFilters')}
            </Button>
          ) : null}
        </div>

        {ledger.isLoading ? (
          <LoadingState label={t('common:common.loading')} />
        ) : ledger.isError ? (
          <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} />
        ) : !ledger.data || ledger.data.rows.length === 0 ? (
          <EmptyState
            title={t('ledger.emptyTitle')}
            hint={filtered ? t('ledger.emptyFilteredHint') : t('ledger.emptyHint')}
            action={
              filtered ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  {t('ledger.clearFilters')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className={cn(ledger.isFetching && 'opacity-70 transition-opacity')} aria-busy={ledger.isFetching}>
            <Table>
              <THead>
                <TR>
                  <TH>{t('common:common.date')}</TH>
                  <TH>{t('ledger.kindColumn')}</TH>
                  <TH className="text-right">{t('ledger.amount')}</TH>
                  <TH>{t('ledger.counterparty')}</TH>
                  <TH>{t('ledger.descriptionColumn')}</TH>
                </TR>
              </THead>
              <TBody>
                {ledger.data.rows.map((row, i) => {
                  const signed = signedLedgerAmount(row);
                  return (
                    <TR key={`${row.kind}-${row.link.handoverId ?? row.link.entryId ?? row.link.saleId ?? row.link.invoiceId ?? 'x'}-${i}`}>
                      <TD className="whitespace-nowrap tabular-nums">{fmtDate(row.date)}</TD>
                      <TD className="whitespace-nowrap">
                        <LedgerKindBadge kind={row.kind} />
                      </TD>
                      <TDMoney className={cn('whitespace-nowrap font-medium', signed < 0 ? 'text-loss' : 'text-profit')}>
                        {fmtEUR(signed, { sign: true })}
                      </TDMoney>
                      <TD className="min-w-[8rem]">{row.counterparty ?? '–'}</TD>
                      <TD className="min-w-[12rem] text-muted-foreground">{row.description ?? '–'}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="pt-3 text-2xs text-muted-foreground">{t('ledger.count', { count: ledger.data.total })}</p>
              <Pager page={page} pageSize={PAGE_SIZE} total={ledger.data.total} onPage={setPage} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
