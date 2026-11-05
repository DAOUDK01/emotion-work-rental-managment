import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Wrench } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { ProductPicker } from './ProductPicker';
import { AdjustDialog, RepairUseDialog } from './StockDialogs';
import { MOVEMENT_TYPES, PAGE_SIZE, fmtSignedQty, fmtTime, localIsoDate, type MovementList, type MovementType, type Product, type StockMovement } from './types';

const TYPE_VARIANT: Record<MovementType, 'success' | 'info' | 'warning' | 'danger' | 'default' | 'navy'> = {
  PURCHASE: 'success',
  IMPORT: 'navy',
  SALE: 'info',
  RETURN: 'default',
  ADJUSTMENT: 'warning',
  REPAIR_USE: 'danger',
  TRANSFER: 'default',
};

/** What the movement is linked to / why it happened (one compact line). */
function MovementDetail({ m }: { m: StockMovement }) {
  const { t } = useTranslation('inventory');
  const parts: string[] = [];
  if (m.reason) parts.push(m.reason);
  if (m.supplier) parts.push(t('movements.fromSupplier', { name: m.supplier.name }));
  if (m.unit) parts.push(t('movements.forUnit', { code: m.unit.code }));
  if (m.saleLine) parts.push(t('movements.sale', { id: m.saleLine.saleId }));
  if (m.creditNote) parts.push(t('movements.creditNote', { number: m.creditNote.numberFormatted }));
  if (m.expense) parts.push(t('movements.expense', { description: m.expense.description }));
  const landed = (m.shippingCents ?? 0) + (m.customsCents ?? 0) + (m.importVatCents ?? 0);
  if (landed > 0) parts.push(t('movements.importCosts', { amount: fmtEUR(landed) }));
  if (m.notes) parts.push(m.notes);
  const text = parts.join(' · ');
  return (
    <span className="line-clamp-2 text-xs text-muted-foreground" title={text || undefined}>
      {text || '–'}
    </span>
  );
}

export function MovementsTab({ canWrite }: { canWrite: boolean }) {
  const { t } = useTranslation('inventory');
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState<MovementType | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);

  useEffect(() => setPage(1), [product, type, from, to]);
  const badRange = from !== '' && to !== '' && from > to;

  const filterQs = useMemo(
    () =>
      qs({
        productId: product?.id,
        type: type || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [product, type, from, to, page],
  );

  const list = useQuery({
    queryKey: ['stock', 'movements', 'list', filterQs],
    queryFn: () => api.get<MovementList>('/stock/movements' + filterQs),
    placeholderData: (prev) => prev,
    enabled: !badRange,
  });

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtersActive = product !== null || type !== '' || from !== '' || to !== '';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-[2] space-y-1.5">
          <Label>{t('movements.product')}</Label>
          <ProductPicker label={t('movements.product')} value={product} onChange={setProduct} allowAll />
        </div>
        <div className="w-44 space-y-1.5">
          <Label htmlFor="mv-type">{t('movements.type')}</Label>
          <Select id="mv-type" value={type} onChange={(e) => setType(e.target.value as MovementType | '')}>
            <option value="">{t('movements.allTypes')}</option>
            {MOVEMENT_TYPES.map((mt) => (
              <option key={mt} value={mt}>
                {t(`movementType.${mt}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="mv-from">{t('common:period.from')}</Label>
          <Input id="mv-from" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="mv-to">{t('common:period.to')}</Label>
          <Input id="mv-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        {filtersActive ? (
          <Button
            variant="ghost"
            onClick={() => {
              setProduct(null);
              setType('');
              setFrom('');
              setTo('');
            }}
          >
            {t('movements.clearFilters')}
          </Button>
        ) : null}
        {canWrite ? (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAdjustOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" /> {t('movements.adjust')}
            </Button>
            <Button variant="outline" onClick={() => setRepairOpen(true)}>
              <Wrench className="h-4 w-4" /> {t('movements.repairUse')}
            </Button>
          </div>
        ) : null}
      </div>
      {badRange ? (
        <p className="text-xs font-medium text-destructive" role="alert">
          {t('movements.badRange')}
        </p>
      ) : null}

      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !data || data.movements.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('movements.noMatches') : t('movements.emptyTitle')}
          hint={filtersActive ? t('products.noMatchesHint') : t('movements.emptyHint')}
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('movements.date')}</TH>
                <TH>{t('movements.product')}</TH>
                <TH>{t('movements.type')}</TH>
                <TH className="text-right">{t('movements.qty')}</TH>
                <TH className="text-right">{t('movements.unitCost')}</TH>
                <TH>{t('movements.details')}</TH>
              </TR>
            </THead>
            <TBody>
              {data.movements.map((m) => (
                <TR key={m.id}>
                  <TD className="whitespace-nowrap tabular-nums">
                    {fmtDate(localIsoDate(m.createdAt))} <span className="text-muted-foreground">{fmtTime(m.createdAt)}</span>
                  </TD>
                  <TD className="min-w-[12rem]">
                    <div className="font-medium">{m.product.nameEn}</div>
                    <div className="font-mono text-2xs text-muted-foreground">{m.product.sku}</div>
                  </TD>
                  <TD>
                    <Badge variant={TYPE_VARIANT[m.type]}>{t(`movementType.${m.type}`)}</Badge>
                  </TD>
                  <TD
                    className={`whitespace-nowrap text-right font-semibold tabular-nums ${m.qty > 0 ? 'text-profit' : m.qty < 0 ? 'text-loss' : ''}`}
                  >
                    {fmtSignedQty(m.qty)}
                  </TD>
                  <TDMoney className="text-muted-foreground">{fmtEUR(m.unitCostCents)}</TDMoney>
                  <TD className="max-w-[22rem]">
                    <MovementDetail m={m} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('movements.count', { count: data.total })}</span>
            {data.total > PAGE_SIZE ? (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t('common:action.back')}
                </Button>
                <span>
                  {t('common:common.page')} {page} {t('common:common.of')} {pages}
                </span>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  {t('common:action.next')}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      <AdjustDialog open={adjustOpen} onClose={() => setAdjustOpen(false)} />
      <RepairUseDialog open={repairOpen} onClose={() => setRepairOpen(false)} />
    </div>
  );
}
