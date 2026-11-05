import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, qs } from '@/lib/api';
import { fmtEUR, fmtNumber, fmtPct } from '@/lib/format';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, KpiCard } from '@/components/ui/card';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { HBars } from '@/components/charts';
import { cn } from '@/components/ui/utils';
import { QueryView, neg, sharePct } from './shared';
import { signClass, type LookupModel, type PnlModelRef, type PnlReport, type SalesGroupBy, type SalesReport } from './types';

// ------------------------------------------------------------------
// Sales — grouped by model / unit / customer / product / received by
// ------------------------------------------------------------------

export function SalesView({ from, to, groupBy }: { from: string; to: string; groupBy: SalesGroupBy }) {
  const { t } = useTranslation('reports');
  const query = useQuery({
    queryKey: ['reports', 'sales', groupBy, from, to],
    queryFn: () => api.get<SalesReport>('/reports/sales' + qs({ groupBy, from, to })),
    placeholderData: keepPreviousData,
  });
  const showQty = groupBy === 'product';

  return (
    <QueryView
      query={query}
      isEmpty={(d) => d.rows.length === 0}
      emptyTitle={t('sales.emptyTitle')}
      emptyHint={t('sales.emptyHint')}
    >
      {(d) => (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label={t('sales.gross')} value={fmtEUR(d.totals.grossCents)} />
            <KpiCard label={t('sales.net')} value={fmtEUR(d.totals.netCents)} />
            <KpiCard label={t('sales.vat')} value={fmtEUR(d.totals.vatCents)} />
            <KpiCard
              label={t('sales.orders')}
              value={fmtNumber(d.totals.orders)}
              sub={`${t('sales.discount')} ${fmtEUR(d.totals.discountCents)}`}
            />
          </div>
          <Table>
            <caption className="sr-only">{t('sales.caption', { group: t(`groupBy.${groupBy}`) })}</caption>
            <THead>
              <TR>
                <TH>{t(`groupBy.${groupBy}`)}</TH>
                <TH className="text-right">{t('sales.orders')}</TH>
                {showQty ? <TH className="text-right">{t('sales.qty')}</TH> : null}
                <TH className="text-right">{t('sales.gross')}</TH>
                <TH className="text-right">{t('sales.discount')}</TH>
                <TH className="text-right">{t('sales.vat')}</TH>
                <TH className="text-right">{t('sales.net')}</TH>
              </TR>
            </THead>
            <TBody>
              {d.rows.map((r) => (
                <TR key={r.key}>
                  <TD className="font-medium">{r.label}</TD>
                  <TD className="text-right tabular-nums">{fmtNumber(r.orders)}</TD>
                  {showQty ? <TD className="text-right tabular-nums">{r.qty === null ? '–' : fmtNumber(r.qty)}</TD> : null}
                  <TDMoney>{fmtEUR(r.grossCents)}</TDMoney>
                  <TDMoney className={r.discountCents > 0 ? 'text-loss' : undefined}>{fmtEUR(r.discountCents)}</TDMoney>
                  <TDMoney>{fmtEUR(r.vatCents)}</TDMoney>
                  <TDMoney className="font-medium">{fmtEUR(r.netCents)}</TDMoney>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD>{t('common:common.total')}</TD>
                <TD className="text-right tabular-nums">{fmtNumber(d.totals.orders)}</TD>
                {showQty ? (
                  <TD className="text-right tabular-nums">{d.totals.qty === null ? '–' : fmtNumber(d.totals.qty)}</TD>
                ) : null}
                <TDMoney>{fmtEUR(d.totals.grossCents)}</TDMoney>
                <TDMoney className={d.totals.discountCents > 0 ? 'text-loss' : undefined}>{fmtEUR(d.totals.discountCents)}</TDMoney>
                <TDMoney>{fmtEUR(d.totals.vatCents)}</TDMoney>
                <TDMoney>{fmtEUR(d.totals.netCents)}</TDMoney>
              </TR>
            </TFoot>
          </Table>
          <p className="text-2xs text-muted-foreground">{t('sales.hint')}</p>
        </div>
      )}
    </QueryView>
  );
}

// ------------------------------------------------------------------
// Profit & loss — statement, per-model chart + table, expense categories
// ------------------------------------------------------------------

function StatementRow({
  label,
  cents,
  strong,
  muted,
  tone,
  sub,
}: {
  label: string;
  cents: number;
  strong?: boolean;
  muted?: boolean;
  tone?: boolean;
  sub?: string;
}) {
  return (
    <TR className={cn(strong && 'font-semibold', muted && 'text-muted-foreground')}>
      <TD>
        {label}
        {sub ? <span className="ml-2 text-2xs font-normal text-muted-foreground">{sub}</span> : null}
      </TD>
      <TDMoney className={tone ? signClass(cents) : undefined}>{fmtEUR(cents)}</TDMoney>
    </TR>
  );
}

export function PnlView({
  from,
  to,
  modelId,
  models,
}: {
  from: string;
  to: string;
  modelId: number;
  models: LookupModel[];
}) {
  const { t, i18n } = useTranslation('reports');
  const query = useQuery({
    queryKey: ['reports', 'pnl', from, to, modelId],
    queryFn: () => api.get<PnlReport>('/reports/pnl' + qs({ from, to, modelId: modelId || undefined })),
    placeholderData: keepPreviousData,
  });
  const modelName = (m: PnlModelRef) => {
    const known = models.find((x) => x.id === m.id);
    const fi = known?.nameFi ?? m.nameFi;
    const en = known?.nameEn ?? m.nameEn;
    return i18n.language === 'fi' ? fi : en;
  };

  return (
    <QueryView
      query={query}
      isEmpty={(d) =>
        d.perModel.every((r) => r.revenueGrossCents === 0) &&
        d.expensesCents === 0 &&
        d.salariesCents === 0 &&
        d.unitPurchasesCents === 0
      }
      emptyTitle={t('pnl.emptyTitle')}
      emptyHint={t('pnl.emptyHint')}
    >
      {(d) => {
        const taxPct = d.taxRateBp / 100;
        const modelRows = d.perModel.filter((r) => !r.isAllModels);
        const allRow = d.perModel.find((r) => r.isAllModels) ?? null;
        const rowLabel = (r: (typeof d.perModel)[number]) => (r.isAllModels ? t('pnl.allModels') : modelName(r.model));
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard label={t('pnl.revenueNet')} value={fmtEUR(d.revenueNetCents)} sub={`${t('pnl.revenueGross')} ${fmtEUR(d.revenueGrossCents)}`} />
              <KpiCard
                label={t('pnl.costs')}
                value={fmtEUR(d.expensesCents + d.salariesCents + d.cogsCents + (d.countUnitPurchases ? d.unitPurchasesCents : 0))}
                sub={t('pnl.costsSub')}
              />
              <KpiCard
                label={t('pnl.netProfit')}
                value={fmtEUR(d.netProfitCents)}
                sub={d.marginPct !== null ? `${t('pnl.margin')} ${fmtPct(d.marginPct, 1)}` : undefined}
                tone={d.netProfitCents >= 0 ? 'profit' : 'loss'}
              />
              <KpiCard
                label={t('pnl.afterTax')}
                value={fmtEUR(d.afterTaxCents)}
                sub={`${t('pnl.taxEstimate', { pct: fmtPct(taxPct, 0) })} ${fmtEUR(d.taxEstimateCents)}`}
                tone={d.afterTaxCents >= 0 ? 'profit' : 'loss'}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>{t('pnl.statement')}</CardTitle>
                  <CardDescription>
                    {d.model ? t('pnl.filteredTo', { model: modelName(d.model) }) : t('pnl.allModelsCompany')}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <caption className="sr-only">{t('pnl.statement')}</caption>
                    <TBody>
                      <StatementRow label={t('pnl.revenueGross')} cents={d.revenueGrossCents} />
                      <StatementRow label={t('pnl.vatOnSales')} cents={neg(d.revenueGrossCents - d.revenueNetCents)} muted />
                      <StatementRow label={t('pnl.revenueNet')} cents={d.revenueNetCents} strong />
                      <StatementRow label={t('pnl.cogs')} cents={neg(d.cogsCents)} />
                      <StatementRow label={t('pnl.expenses')} cents={neg(d.expensesCents)} />
                      <StatementRow label={t('pnl.salaries')} cents={neg(d.salariesCents)} />
                      <StatementRow
                        label={t('pnl.unitPurchases')}
                        cents={d.countUnitPurchases ? neg(d.unitPurchasesCents) : d.unitPurchasesCents}
                        muted={!d.countUnitPurchases}
                        sub={d.countUnitPurchases ? t('pnl.counted') : t('pnl.notCounted')}
                      />
                    </TBody>
                    <TFoot>
                      <StatementRow
                        label={t('pnl.netProfit')}
                        cents={d.netProfitCents}
                        tone
                        sub={d.marginPct !== null ? `${t('pnl.margin')} ${fmtPct(d.marginPct, 1)}` : undefined}
                      />
                      <StatementRow label={t('pnl.taxEstimate', { pct: fmtPct(taxPct, 0) })} cents={neg(d.taxEstimateCents)} muted />
                      <StatementRow label={t('pnl.afterTax')} cents={d.afterTaxCents} tone />
                    </TFoot>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{t('pnl.perModel')}</CardTitle>
                  <CardDescription>{t('pnl.perModelHint')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {d.perModel.length > 0 ? (
                    <HBars data={d.perModel.map((r) => ({ label: rowLabel(r), value: r.profitCents }))} colorBy="sign" />
                  ) : (
                    <EmptyState title={t('pnl.noModels')} />
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('pnl.perModelTable')}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('pnl.model')}</TH>
                      <TH className="text-right">{t('pnl.revenueGross')}</TH>
                      <TH className="text-right">{t('pnl.revenueNet')}</TH>
                      <TH className="text-right">{t('pnl.sharedCosts')}</TH>
                      <TH className="text-right">{t('pnl.profit')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {modelRows.length === 0 ? (
                      <TR>
                        <TD colSpan={5} className="text-center text-xs text-muted-foreground">
                          {t('pnl.noModels')}
                        </TD>
                      </TR>
                    ) : (
                      modelRows.map((r) => (
                        <TR key={r.model.id}>
                          <TD className="font-medium">
                            {rowLabel(r)}
                            {d.model && d.model.id === r.model.id ? (
                              <Badge variant="info" className="ml-2">
                                {t('pnl.filtered')}
                              </Badge>
                            ) : null}
                          </TD>
                          <TDMoney>{fmtEUR(r.revenueGrossCents)}</TDMoney>
                          <TDMoney>{fmtEUR(r.revenueNetCents)}</TDMoney>
                          <TDMoney className="text-muted-foreground" title={t('pnl.sharedOnlyHint')}>
                            –
                          </TDMoney>
                          <TDMoney className={signClass(r.profitCents)}>{fmtEUR(r.profitCents)}</TDMoney>
                        </TR>
                      ))
                    )}
                  </TBody>
                  {allRow ? (
                    <TFoot>
                      <TR>
                        <TD>{t('pnl.allModels')}</TD>
                        <TDMoney>{fmtEUR(allRow.revenueGrossCents)}</TDMoney>
                        <TDMoney>{fmtEUR(allRow.revenueNetCents)}</TDMoney>
                        <TDMoney>{fmtEUR(neg(allRow.costsCents))}</TDMoney>
                        <TDMoney className={signClass(allRow.profitCents)}>{fmtEUR(allRow.profitCents)}</TDMoney>
                      </TR>
                    </TFoot>
                  ) : null}
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('pnl.expenseCategories')}</CardTitle>
                <CardDescription>{t('pnl.expenseCategoriesHint')}</CardDescription>
              </CardHeader>
              <CardContent>
                {d.expensesByCategory.length === 0 ? (
                  <EmptyState title={t('pnl.noExpenses')} />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t('pnl.category')}</TH>
                        <TH className="text-right">{t('pnl.share')}</TH>
                        <TH className="text-right">{t('pnl.amountGross')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {d.expensesByCategory.map((c) => (
                        <TR key={c.category}>
                          <TD>{c.category}</TD>
                          <TD className="text-right tabular-nums text-muted-foreground">
                            {fmtPct(sharePct(c.grossCents, d.expensesCents), 1)}
                          </TD>
                          <TDMoney>{fmtEUR(c.grossCents)}</TDMoney>
                        </TR>
                      ))}
                    </TBody>
                    <TFoot>
                      <TR>
                        <TD>{t('common:common.total')}</TD>
                        <TD className="text-right tabular-nums">{fmtPct(100, 0)}</TD>
                        <TDMoney>{fmtEUR(d.expensesCents)}</TDMoney>
                      </TR>
                    </TFoot>
                  </Table>
                )}
              </CardContent>
            </Card>

            <p className="text-2xs text-muted-foreground">
              {d.model ? t('pnl.noteFiltered', { model: modelName(d.model) }) : t('pnl.note')}
            </p>
          </div>
        );
      }}
    </QueryView>
  );
}
