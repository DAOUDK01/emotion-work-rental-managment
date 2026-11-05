import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowRight, FileSpreadsheet } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, downloadFile, qs } from '@/lib/api';
import { fmtDate, fmtEUR, fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, KpiCard } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { QueryView } from './shared';
import type { CashLedgerReport, ZReportsReport } from './types';

// ------------------------------------------------------------------
// Cash ledger — handovers in the period + holder balances (now)
// ------------------------------------------------------------------

export function CashLedgerView({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation('reports');
  const query = useQuery({
    queryKey: ['reports', 'cash-ledger', from, to],
    queryFn: () => api.get<CashLedgerReport>('/reports/cash-ledger' + qs({ from, to })),
    placeholderData: keepPreviousData,
  });

  return (
    <QueryView
      query={query}
      isEmpty={(d) => d.handovers.length === 0 && d.balances.length === 0}
      emptyTitle={t('cash.emptyTitle')}
      emptyHint={t('cash.emptyHint')}
    >
      {(d) => {
        const totals = d.balances.reduce(
          (a, b) => ({
            receivedCents: a.receivedCents + b.receivedCents,
            handedOverCents: a.handedOverCents + b.handedOverCents,
          }),
          { receivedCents: 0, handedOverCents: 0 },
        );
        const partnersHolding = d.balances
          .filter((b) => b.holder.kind !== 'COMPANY')
          .reduce((a, b) => a + b.holdingCents, 0);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <KpiCard label={t('cash.handoverTotal')} value={fmtEUR(d.handoverTotalCents)} sub={t('cash.inPeriod')} />
              <KpiCard label={t('cash.handoverCount')} value={fmtNumber(d.handovers.length)} sub={t('cash.inPeriod')} />
              <KpiCard
                label={t('cash.heldOutside')}
                value={fmtEUR(partnersHolding)}
                sub={t('cash.heldOutsideSub')}
                tone={partnersHolding > 0 ? 'loss' : 'default'}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('cash.balances')}</CardTitle>
                <CardDescription>{t('cash.balancesHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                {d.balances.length === 0 ? (
                  <EmptyState title={t('cash.noHolders')} />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t('cash.holder')}</TH>
                        <TH>{t('cash.kind')}</TH>
                        <TH className="text-right">{t('cash.received')}</TH>
                        <TH className="text-right">{t('cash.handedOver')}</TH>
                        <TH className="text-right">{t('cash.holding')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {d.balances.map((b) => (
                        <TR key={b.holder.id}>
                          <TD className="font-medium">{b.holder.name}</TD>
                          <TD>
                            <Badge variant={b.holder.kind === 'COMPANY' ? 'navy' : 'default'}>
                              {t(`cash.kinds.${b.holder.kind}`)}
                            </Badge>
                          </TD>
                          <TDMoney>{fmtEUR(b.receivedCents)}</TDMoney>
                          <TDMoney>{fmtEUR(b.handedOverCents)}</TDMoney>
                          <TDMoney
                            className={cn(
                              'font-medium',
                              b.holdingCents < 0 && 'text-loss',
                              b.holdingCents > 0 && b.holder.kind !== 'COMPANY' && 'text-amber-700 dark:text-amber-400',
                            )}
                            title={b.holdingCents > 0 && b.holder.kind !== 'COMPANY' ? t('cash.toHandOver') : undefined}
                          >
                            {fmtEUR(b.holdingCents)}
                          </TDMoney>
                        </TR>
                      ))}
                    </TBody>
                    <TFoot>
                      <TR>
                        <TD colSpan={2}>{t('common:common.total')}</TD>
                        <TDMoney>{fmtEUR(totals.receivedCents)}</TDMoney>
                        <TDMoney>{fmtEUR(totals.handedOverCents)}</TDMoney>
                        <TDMoney />
                      </TR>
                    </TFoot>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('cash.handovers')}</CardTitle>
              </CardHeader>
              <CardContent>
                {d.handovers.length === 0 ? (
                  <EmptyState title={t('cash.noHandovers')} hint={t('cash.noHandoversHint')} />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t('common:common.date')}</TH>
                        <TH>{t('cash.fromTo')}</TH>
                        <TH>{t('common:common.notes')}</TH>
                        <TH className="text-right">{t('cash.amount')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {d.handovers.map((h) => (
                        <TR key={h.id}>
                          <TD className="whitespace-nowrap tabular-nums">{fmtDate(h.date)}</TD>
                          <TD>
                            <span className="inline-flex flex-wrap items-center gap-1">
                              {h.fromHolder.name}
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-label={t('cash.to')} />
                              {h.toHolder.name}
                            </span>
                          </TD>
                          <TD className="text-muted-foreground">{h.note ?? '–'}</TD>
                          <TDMoney>{fmtEUR(h.amountCents)}</TDMoney>
                        </TR>
                      ))}
                    </TBody>
                    <TFoot>
                      <TR>
                        <TD colSpan={3}>{t('common:common.total')}</TD>
                        <TDMoney>{fmtEUR(d.handoverTotalCents)}</TDMoney>
                      </TR>
                    </TFoot>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        );
      }}
    </QueryView>
  );
}

// ------------------------------------------------------------------
// Z-reports — daily POS summaries
// ------------------------------------------------------------------

export function ZReportsView({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation('reports');
  const query = useQuery({
    queryKey: ['reports', 'zreports', from, to],
    queryFn: () => api.get<ZReportsReport>('/reports/zreports' + qs({ from, to })),
    placeholderData: keepPreviousData,
  });

  return (
    <QueryView
      query={query}
      isEmpty={(d) => d.rows.length === 0}
      emptyTitle={t('zreports.emptyTitle')}
      emptyHint={t('zreports.emptyHint')}
    >
      {(d) => {
        const byMethod = new Map<string, number>();
        for (const r of d.rows) {
          for (const m of r.byMethod) byMethod.set(m.method, (byMethod.get(m.method) ?? 0) + m.amountCents);
        }
        const methodTotals = [...byMethod.entries()].sort((a, b) => b[1] - a[1]);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard label={t('zreports.gross')} value={fmtEUR(d.totals.grossCents)} />
              <KpiCard label={t('zreports.net')} value={fmtEUR(d.totals.netCents)} />
              <KpiCard label={t('zreports.vat')} value={fmtEUR(d.totals.vatCents)} />
              <KpiCard
                label={t('zreports.sales')}
                value={fmtNumber(d.totals.salesCount)}
                sub={t('zreports.daysCount', { count: d.rows.length })}
              />
            </div>
            <Table>
              <caption className="sr-only">{t('types.zreports')}</caption>
              <THead>
                <TR>
                  <TH>{t('common:common.date')}</TH>
                  <TH className="text-right">{t('zreports.sales')}</TH>
                  <TH>{t('zreports.byMethod')}</TH>
                  <TH className="text-right">{t('zreports.gross')}</TH>
                  <TH className="text-right">{t('zreports.vat')}</TH>
                  <TH className="text-right">{t('zreports.net')}</TH>
                </TR>
              </THead>
              <TBody>
                {d.rows.map((r) => (
                  <TR key={r.date}>
                    <TD className="whitespace-nowrap font-medium tabular-nums">{fmtDate(r.date)}</TD>
                    <TD className="text-right tabular-nums">{fmtNumber(r.salesCount)}</TD>
                    <TD>
                      {r.byMethod.length === 0 ? (
                        <span className="text-xs text-muted-foreground">{t('zreports.noPayments')}</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {r.byMethod.map((m) => (
                            <Badge key={m.method} variant="outline" className="tabular-nums">
                              {m.method} {fmtEUR(m.amountCents)}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </TD>
                    <TDMoney>{fmtEUR(r.grossCents)}</TDMoney>
                    <TDMoney>{fmtEUR(r.vatCents)}</TDMoney>
                    <TDMoney className="font-medium">{fmtEUR(r.netCents)}</TDMoney>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD>{t('common:common.total')}</TD>
                  <TD className="text-right tabular-nums">{fmtNumber(d.totals.salesCount)}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {methodTotals.map(([method, cents]) => (
                        <Badge key={method} variant="outline" className="tabular-nums">
                          {method} {fmtEUR(cents)}
                        </Badge>
                      ))}
                    </div>
                  </TD>
                  <TDMoney>{fmtEUR(d.totals.grossCents)}</TDMoney>
                  <TDMoney>{fmtEUR(d.totals.vatCents)}</TDMoney>
                  <TDMoney>{fmtEUR(d.totals.netCents)}</TDMoney>
                </TR>
              </TFoot>
            </Table>
            <p className="text-2xs text-muted-foreground">{t('zreports.hint')}</p>
          </div>
        );
      }}
    </QueryView>
  );
}

// ------------------------------------------------------------------
// Accountant pack — one xlsx per month
// ------------------------------------------------------------------

const PACK_SHEETS = ['entries', 'expenses', 'vatSummary', 'payments', 'handovers', 'invoices', 'creditNotes'] as const;

function previousMonth(): string {
  const [y, m] = todayInHelsinki().split('-').map(Number);
  const year = m === 1 ? y - 1 : y;
  const month = m === 1 ? 12 : m - 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function AccountantPackView() {
  const { t } = useTranslation('reports');
  const [month, setMonth] = useState<string>(previousMonth);
  const currentMonth = todayInHelsinki().slice(0, 7);
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month);

  const download = useMutation({
    mutationFn: (m: string) => downloadFile('/reports/accountant-pack' + qs({ month: m }), `accountant-${m}.xlsx`),
    onSuccess: () => toast.success(t('download.ready')),
    onError: (err: Error) => toast.error(err.message || t('download.failed')),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pack.title')}</CardTitle>
        <CardDescription>{t('pack.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !download.isPending) download.mutate(month);
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="pack-month">
              {t('pack.month')}
              <span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="pack-month"
              type="month"
              className="w-44"
              value={month}
              max={currentMonth}
              required
              aria-invalid={!valid}
              onChange={(e) => setMonth(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={!valid || download.isPending}>
            <FileSpreadsheet className="h-4 w-4" />
            {download.isPending ? t('download.preparing') : t('pack.download')}
          </Button>
        </form>
        {!valid ? <p className="text-2xs font-medium text-destructive">{t('pack.invalidMonth')}</p> : null}
        <div className="rounded-md border bg-muted/30 p-3">
          <p className="mb-2 text-xs font-semibold">{t('pack.sheetsTitle')}</p>
          <ul className="grid gap-1.5 text-xs sm:grid-cols-2">
            {PACK_SHEETS.map((s) => (
              <li key={s} className="flex gap-2">
                <Badge variant="outline" className="shrink-0">
                  {t(`pack.sheets.${s}.name`)}
                </Badge>
                <span className="text-muted-foreground">{t(`pack.sheets.${s}.hint`)}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-2xs text-muted-foreground">{t('pack.auditNote')}</p>
      </CardContent>
    </Card>
  );
}
