import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtEUR, fmtNumber, fmtPct } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle, KpiCard } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { QueryView, sharePct } from './shared';
import type { DiscountRow, DiscountsReport, InventoryReport, LookupModel, OutstandingReport } from './types';

// ------------------------------------------------------------------
// Discounts — every discount record + grouping by reason
// ------------------------------------------------------------------

/** Bucket name the API uses for discounts without a reason (shown translated). */
const SERVER_NO_REASON = 'No reason given';

export function DiscountsView({ from, to, models }: { from: string; to: string; models: LookupModel[] }) {
  const { t, i18n } = useTranslation('reports');
  const query = useQuery({
    queryKey: ['reports', 'discounts', from, to],
    queryFn: () => api.get<DiscountsReport>('/reports/discounts' + qs({ from, to })),
    placeholderData: keepPreviousData,
  });

  const modelName = (m: NonNullable<DiscountRow['model']>) => {
    const known = models.find((x) => x.id === m.id);
    if (!known) return m.nameEn;
    return i18n.language === 'fi' ? known.nameFi : known.nameEn;
  };
  const source = (r: DiscountRow) => {
    if (r.saleId !== null) return t('discounts.source.sale', { id: r.saleId });
    if (r.invoiceId !== null) return t('discounts.source.invoice', { id: r.invoiceId });
    if (r.entryId !== null) return t('discounts.source.entry', { id: r.entryId });
    return '–';
  };

  return (
    <QueryView
      query={query}
      isEmpty={(d) => d.rows.length === 0}
      emptyTitle={t('discounts.emptyTitle')}
      emptyHint={t('discounts.emptyHint')}
    >
      {(d) => (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <KpiCard label={t('discounts.total')} value={fmtEUR(d.totalCents)} tone="loss" />
            <KpiCard label={t('discounts.count')} value={fmtNumber(d.count)} />
            <KpiCard
              label={t('discounts.average')}
              value={fmtEUR(d.count > 0 ? Math.round(d.totalCents / d.count) : 0)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('discounts.byReason')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('discounts.reason')}</TH>
                    <TH className="text-right">{t('discounts.count')}</TH>
                    <TH className="text-right">{t('discounts.share')}</TH>
                    <TH className="text-right">{t('discounts.amount')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {d.byReason.map((r) => (
                    <TR key={r.reason}>
                      <TD className="font-medium">
                        {r.reason === SERVER_NO_REASON ? (
                          <span className="text-muted-foreground">{t('discounts.noReason')}</span>
                        ) : (
                          r.reason
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">{fmtNumber(r.count)}</TD>
                      <TD className="text-right tabular-nums text-muted-foreground">
                        {fmtPct(sharePct(r.amountCents, d.totalCents), 1)}
                      </TD>
                      <TDMoney>{fmtEUR(r.amountCents)}</TDMoney>
                    </TR>
                  ))}
                </TBody>
                <TFoot>
                  <TR>
                    <TD>{t('common:common.total')}</TD>
                    <TD className="text-right tabular-nums">{fmtNumber(d.count)}</TD>
                    <TD className="text-right tabular-nums">{fmtPct(100, 0)}</TD>
                    <TDMoney>{fmtEUR(d.totalCents)}</TDMoney>
                  </TR>
                </TFoot>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('discounts.allRecords')}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('common:common.date')}</TH>
                    <TH>{t('discounts.model')}</TH>
                    <TH>{t('discounts.reason')}</TH>
                    <TH>{t('discounts.sourceLabel')}</TH>
                    <TH className="text-right">{t('discounts.amount')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {d.rows.map((r) => (
                    <TR key={r.id}>
                      <TD className="whitespace-nowrap tabular-nums">{fmtDate(r.date)}</TD>
                      <TD>{r.model ? modelName(r.model) : '–'}</TD>
                      <TD>
                        {r.reason && r.reason.trim() !== '' ? (
                          r.reason
                        ) : (
                          <span className="text-muted-foreground">{t('discounts.noReason')}</span>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-muted-foreground">{source(r)}</TD>
                      <TDMoney>{fmtEUR(r.amountCents)}</TDMoney>
                    </TR>
                  ))}
                </TBody>
                <TFoot>
                  <TR>
                    <TD colSpan={4}>{t('common:common.total')}</TD>
                    <TDMoney>{fmtEUR(d.totalCents)}</TDMoney>
                  </TR>
                </TFoot>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </QueryView>
  );
}

// ------------------------------------------------------------------
// Outstanding — unpaid entries grouped by customer (snapshot, no period)
// ------------------------------------------------------------------

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.max(0, Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000));
}

export function OutstandingView() {
  const { t } = useTranslation('reports');
  const query = useQuery({
    queryKey: ['reports', 'outstanding'],
    queryFn: () => api.get<OutstandingReport>('/reports/outstanding'),
  });
  const today = todayInHelsinki();

  return (
    <QueryView
      query={query}
      isEmpty={(d) => d.rows.length === 0}
      emptyTitle={t('outstanding.emptyTitle')}
      emptyHint={t('outstanding.emptyHint')}
    >
      {(d) => {
        const items = d.rows.reduce((a, r) => a + r.items, 0);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <KpiCard label={t('outstanding.total')} value={fmtEUR(d.totalCents)} tone={d.totalCents > 0 ? 'loss' : 'default'} />
              <KpiCard label={t('outstanding.customers')} value={fmtNumber(d.rows.length)} />
              <KpiCard label={t('outstanding.items')} value={fmtNumber(items)} />
            </div>
            <Table>
              <caption className="sr-only">{t('types.outstanding')}</caption>
              <THead>
                <TR>
                  <TH>{t('outstanding.customer')}</TH>
                  <TH className="text-right">{t('outstanding.items')}</TH>
                  <TH>{t('outstanding.oldest')}</TH>
                  <TH>{t('outstanding.age')}</TH>
                  <TH className="text-right">{t('outstanding.amount')}</TH>
                </TR>
              </THead>
              <TBody>
                {d.rows.map((r) => {
                  const age = daysBetween(r.oldestDate, today);
                  return (
                    <TR key={`${r.customerId ?? 'n'}-${r.customerName}`}>
                      <TD className="font-medium">{r.customerName}</TD>
                      <TD className="text-right tabular-nums">{fmtNumber(r.items)}</TD>
                      <TD className="whitespace-nowrap tabular-nums">{fmtDate(r.oldestDate)}</TD>
                      <TD>
                        <Badge variant={age > 60 ? 'danger' : age > 30 ? 'warning' : 'default'}>
                          {t('outstanding.days', { count: age })}
                        </Badge>
                      </TD>
                      <TDMoney className="text-loss">{fmtEUR(r.amountCents)}</TDMoney>
                    </TR>
                  );
                })}
              </TBody>
              <TFoot>
                <TR>
                  <TD>{t('common:common.total')}</TD>
                  <TD className="text-right tabular-nums">{fmtNumber(items)}</TD>
                  <TD colSpan={2} />
                  <TDMoney className="text-loss">{fmtEUR(d.totalCents)}</TDMoney>
                </TR>
              </TFoot>
            </Table>
          </div>
        );
      }}
    </QueryView>
  );
}

// ------------------------------------------------------------------
// Inventory valuation — tracked products with stock on hand (snapshot)
// ------------------------------------------------------------------

export function InventoryView() {
  const { t } = useTranslation('reports');
  const query = useQuery({
    queryKey: ['reports', 'inventory'],
    queryFn: () => api.get<InventoryReport>('/reports/inventory'),
  });

  return (
    <QueryView
      query={query}
      isEmpty={(d) => d.rows.length === 0}
      emptyTitle={t('inventory.emptyTitle')}
      emptyHint={t('inventory.emptyHint')}
    >
      {(d) => (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <KpiCard label={t('inventory.value')} value={fmtEUR(d.totals.valueCents)} />
            <KpiCard label={t('inventory.products')} value={fmtNumber(d.totals.products)} />
            <KpiCard label={t('inventory.qty')} value={fmtNumber(d.totals.qty)} />
          </div>
          <Table>
            <caption className="sr-only">{t('types.inventory')}</caption>
            <THead>
              <TR>
                <TH>{t('inventory.sku')}</TH>
                <TH>{t('inventory.name')}</TH>
                <TH>{t('inventory.category')}</TH>
                <TH className="text-right">{t('inventory.qty')}</TH>
                <TH className="text-right">{t('inventory.unitCost')}</TH>
                <TH className="text-right">{t('inventory.value')}</TH>
              </TR>
            </THead>
            <TBody>
              {d.rows.map((r) => (
                <TR key={r.productId}>
                  <TD className="whitespace-nowrap font-mono text-xs">{r.sku}</TD>
                  <TD className="font-medium">{r.name}</TD>
                  <TD className="text-muted-foreground">{r.category ?? '–'}</TD>
                  <TD className="text-right tabular-nums">{fmtNumber(r.qty)}</TD>
                  <TDMoney>
                    {r.costCents === 0 ? (
                      <Badge variant="warning" title={t('inventory.noCostHint')}>
                        {t('inventory.noCost')}
                      </Badge>
                    ) : (
                      fmtEUR(r.costCents)
                    )}
                  </TDMoney>
                  <TDMoney className="font-medium">{fmtEUR(r.valueCents)}</TDMoney>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={3}>
                  {t('common:common.total')} · {t('inventory.productsCount', { count: d.totals.products })}
                </TD>
                <TD className="text-right tabular-nums">{fmtNumber(d.totals.qty)}</TD>
                <TD />
                <TDMoney>{fmtEUR(d.totals.valueCents)}</TDMoney>
              </TR>
            </TFoot>
          </Table>
          <p className="text-2xs text-muted-foreground">{t('inventory.hint')}</p>
        </div>
      )}
    </QueryView>
  );
}
