import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PackagePlus } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtEUR, fmtEURShort, fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, KpiCard } from '@/components/ui/card';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { HBars } from '@/components/charts';
import { productName, type Product, type StockValue } from './types';

/** Low-stock list (at/below reorder level, most critical first) + stock valuation by category. */
export function LowStockTab({ canWrite, onReceive }: { canWrite: boolean; onReceive: (product: Product) => void }) {
  const { t, i18n } = useTranslation('inventory');

  const low = useQuery({
    queryKey: ['stock', 'low'],
    queryFn: () => api.get<{ products: Product[]; total: number }>('/stock/low'),
  });
  const value = useQuery({
    queryKey: ['stock', 'value'],
    queryFn: () => api.get<StockValue>('/stock/value'),
  });

  const categoryLabel = (c: string) => (c === 'Uncategorised' ? t('lowStock.uncategorised') : c);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('lowStock.title')}</CardTitle>
          <CardDescription>{t('lowStock.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          {low.isLoading ? (
            <LoadingState />
          ) : low.isError ? (
            <ErrorState error={low.error} onRetry={() => void low.refetch()} />
          ) : !low.data || low.data.products.length === 0 ? (
            <EmptyState title={t('lowStock.emptyTitle')} hint={t('lowStock.emptyHint')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('products.sku')}</TH>
                  <TH>{t('products.name')}</TH>
                  <TH>{t('products.category')}</TH>
                  <TH className="text-right">{t('products.stock')}</TH>
                  <TH className="text-right">{t('products.reorder')}</TH>
                  <TH className="text-right">{t('lowStock.shortBy')}</TH>
                  <TH>{t('products.location')}</TH>
                  <TH>{t('form.supplier')}</TH>
                  <TH className="text-right">{t('products.cost')}</TH>
                  {canWrite ? <TH className="text-right">{t('common:common.actions')}</TH> : null}
                </TR>
              </THead>
              <TBody>
                {low.data.products.map((p) => {
                  const qty = p.stockQty ?? 0;
                  const shortBy = Math.max(0, p.reorderLevel - qty);
                  return (
                    <TR key={p.id}>
                      <TD className="whitespace-nowrap font-mono text-xs">{p.sku}</TD>
                      <TD className="min-w-[12rem] font-medium">{productName(p, i18n.language)}</TD>
                      <TD className="whitespace-nowrap">{p.category ?? '–'}</TD>
                      <TD className="text-right tabular-nums">
                        {qty <= 0 ? (
                          <Badge variant="danger">{qty === 0 ? t('lowStock.out') : qty}</Badge>
                        ) : (
                          <span className="font-semibold text-amber-700 dark:text-amber-400">{qty}</span>
                        )}
                      </TD>
                      <TD className="text-right tabular-nums">{p.reorderLevel}</TD>
                      <TD className="text-right font-semibold tabular-nums">{shortBy > 0 ? shortBy : '–'}</TD>
                      <TD className="whitespace-nowrap">{p.location ?? '–'}</TD>
                      <TD className="whitespace-nowrap">{p.supplier?.name ?? '–'}</TD>
                      <TDMoney className="text-muted-foreground">{fmtEUR(p.costCents)}</TDMoney>
                      {canWrite ? (
                        <TD className="text-right">
                          <Button variant="outline" size="sm" onClick={() => onReceive(p)}>
                            <PackagePlus className="h-3.5 w-3.5" /> {t('lowStock.receive')}
                          </Button>
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {value.isLoading ? (
        <LoadingState />
      ) : value.isError ? (
        <ErrorState error={value.error} onRetry={() => void value.refetch()} />
      ) : value.data ? (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="grid content-start gap-3">
            <KpiCard
              label={t('value.total')}
              value={fmtEURShort(value.data.totalCents)}
              sub={t('value.totalSub')}
            />
            <KpiCard
              label={t('value.pieces')}
              value={fmtNumber(value.data.byCategory.reduce((s, c) => s + c.qty, 0))}
              sub={t('value.products', { count: value.data.byCategory.reduce((s, c) => s + c.productCount, 0) })}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('value.byCategory')}</CardTitle>
              <CardDescription>{t('value.byCategoryHint')}</CardDescription>
            </CardHeader>
            <CardContent>
              {value.data.byCategory.length === 0 ? (
                <EmptyState title={t('value.emptyTitle')} hint={t('value.emptyHint')} />
              ) : (
                <>
                  <HBars
                    data={value.data.byCategory.map((c) => ({ label: categoryLabel(c.category), value: c.valueCents }))}
                    color="#2a9d8f"
                  />
                  <ul className="mt-2 grid gap-1 text-2xs text-muted-foreground sm:grid-cols-2">
                    {value.data.byCategory.map((c) => (
                      <li key={c.category}>
                        {categoryLabel(c.category)}: {t('value.categoryLine', { qty: c.qty, count: c.productCount })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
