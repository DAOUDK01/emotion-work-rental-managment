import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban, CheckCircle2, Pencil, Plus, Search, Tag } from 'lucide-react';
import { api, downloadFile, qs } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { ProductFormDialog } from './ProductFormDialog';
import { PAGE_SIZE, type Product, type ProductList } from './types';

type ActiveFilter = 'true' | 'false' | 'all';

/** Distinct product categories (for the filter + form suggestions). */
export function useProductCategories() {
  return useQuery({
    queryKey: ['products', 'categories'],
    queryFn: () => api.get<ProductList>('/products' + qs({ pageSize: 200 })),
    staleTime: 60_000,
    select: (d) =>
      [...new Set(d.products.map((p) => p.category?.trim()).filter((c): c is string => !!c))].sort((a, b) =>
        a.localeCompare(b),
      ),
  });
}

function LabelsDialog({ product, onClose }: { product: Product | null; onClose: () => void }) {
  const { t } = useTranslation('inventory');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (product) setQty('1');
  }, [product]);
  const n = Number(qty);
  const valid = /^\d+$/.test(qty) && n >= 1 && n <= 120;

  const download = async () => {
    if (!product || !valid) return;
    setBusy(true);
    try {
      await downloadFile(`/products/${product.id}/label${qs({ qty: n })}`, `labels-${product.sku}.pdf`);
      toast.success(t('labels.ready'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:common.errorTitle'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={product !== null}
      onClose={onClose}
      title={t('labels.title', { sku: product?.sku ?? '' })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={() => void download()} disabled={!valid || busy}>
            <Tag className="h-3.5 w-3.5" /> {t('common:action.downloadPdf')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void download();
        }}
        className="space-y-3"
      >
        <p className="text-sm text-muted-foreground">
          {product?.barcodes[0] ? t('labels.withBarcode', { code: product.barcodes[0].barcode }) : t('labels.internal')}
        </p>
        <Field label={t('labels.qty')} error={valid ? undefined : t('labels.qtyRange')} required>
          <Input autoFocus inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

export function ProductsTab({ canWrite }: { canWrite: boolean }) {
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState<ActiveFilter>('true');
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Product | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [labelsFor, setLabelsFor] = useState<Product | null>(null);
  const [deactivating, setDeactivating] = useState<Product | null>(null);

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);
  useEffect(() => setPage(1), [q, category, active, lowOnly]);

  const filterQs = useMemo(
    () =>
      qs({
        q: q || undefined,
        category: category || undefined,
        active: active === 'all' ? undefined : active,
        lowStock: lowOnly ? 'true' : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [q, category, active, lowOnly, page],
  );

  const list = useQuery({
    queryKey: ['products', 'list', filterQs],
    queryFn: () => api.get<ProductList>('/products' + filterQs),
    placeholderData: (prev) => prev,
  });
  const categories = useProductCategories();

  const toggleActive = useMutation({
    mutationFn: (p: Product) => api.put<{ product: Product }>(`/products/${p.id}`, { active: !p.active }),
    onSuccess: ({ product }) => {
      toast.success(product.active ? t('products.reactivated', { sku: product.sku }) : t('products.deactivated', { sku: product.sku }));
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      setDeactivating(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const filtersActive = q !== '' || category !== '' || active !== 'true' || lowOnly;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('products.searchPlaceholder')}
            aria-label={t('common:action.search')}
          />
        </div>
        <Select
          aria-label={t('products.category')}
          className="h-9 w-44"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">{t('products.allCategories')}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Segmented
          size="sm"
          value={active}
          onChange={setActive}
          options={[
            { value: 'true' as const, label: t('products.activeOnly') },
            { value: 'false' as const, label: t('products.inactiveOnly') },
            { value: 'all' as const, label: t('common:common.all') },
          ]}
        />
        <Checkbox label={t('products.lowStockOnly')} checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
        {canWrite ? (
          <Button className="ml-auto" onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t('products.new')}
          </Button>
        ) : null}
      </div>

      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !data || data.products.length === 0 ? (
        <EmptyState
          title={filtersActive ? t('products.noMatches') : t('products.emptyTitle')}
          hint={filtersActive ? t('products.noMatchesHint') : t('products.emptyHint')}
          action={
            canWrite && !filtersActive ? (
              <Button onClick={openCreate}>
                <Plus className="h-4 w-4" /> {t('products.new')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('products.sku')}</TH>
                <TH>{t('products.name')}</TH>
                <TH>{t('products.category')}</TH>
                <TH className="text-right">{t('products.price')}</TH>
                <TH className="text-right">{t('products.cost')}</TH>
                <TH className="text-right">{t('products.stock')}</TH>
                <TH className="text-right">{t('products.reorder')}</TH>
                <TH>{t('products.location')}</TH>
                <TH className="text-right">{t('products.barcodes')}</TH>
                <TH>{t('products.active')}</TH>
                {canWrite ? <TH className="text-right">{t('common:common.actions')}</TH> : null}
              </TR>
            </THead>
            <TBody>
              {data.products.map((p) => (
                <TR key={p.id} className={p.active ? undefined : 'opacity-60'}>
                  <TD className="whitespace-nowrap font-mono text-xs">{p.sku}</TD>
                  <TD className="min-w-[12rem]">
                    <div className="font-medium">{p.nameEn}</div>
                    {p.nameFi ? <div className="text-2xs text-muted-foreground" lang="fi">{p.nameFi}</div> : null}
                  </TD>
                  <TD className="whitespace-nowrap">{p.category ?? '–'}</TD>
                  <TDMoney>{fmtEUR(p.priceCents)}</TDMoney>
                  <TDMoney className="text-muted-foreground">{fmtEUR(p.costCents)}</TDMoney>
                  <TD className="whitespace-nowrap text-right tabular-nums">
                    {p.stockQty === null ? (
                      <span className="text-muted-foreground" title={t('products.serviceNoStock')}>
                        —
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5">
                        {p.lowStock ? <Badge variant={p.stockQty <= 0 ? 'danger' : 'warning'}>{t('products.low')}</Badge> : null}
                        <span className={p.stockQty < 0 ? 'text-loss font-semibold' : p.lowStock ? 'font-semibold' : undefined}>
                          {p.stockQty}
                        </span>
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{p.trackStock ? p.reorderLevel : '—'}</TD>
                  <TD className="whitespace-nowrap">{p.location ?? '–'}</TD>
                  <TD className="text-right tabular-nums" title={p.barcodes.map((b) => b.barcode).join(', ') || undefined}>
                    {p.barcodes.length}
                  </TD>
                  <TD>
                    <Badge variant={p.active ? 'success' : 'default'}>
                      {p.active ? t('common:common.yes') : t('common:common.no')}
                    </Badge>
                  </TD>
                  {canWrite ? (
                    <TD className="whitespace-nowrap text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => {
                            setEditing(p);
                            setFormOpen(true);
                          }}
                          aria-label={`${t('common:action.edit')} ${p.sku}`}
                          title={t('common:action.edit')}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setLabelsFor(p)}
                          aria-label={`${t('labels.button')} ${p.sku}`}
                          title={t('labels.button')}
                        >
                          <Tag className="h-3.5 w-3.5" />
                        </Button>
                        {p.active ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => setDeactivating(p)}
                            aria-label={`${t('products.deactivate')} ${p.sku}`}
                            title={t('products.deactivate')}
                          >
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-profit"
                            onClick={() => toggleActive.mutate(p)}
                            disabled={toggleActive.isPending}
                            aria-label={`${t('products.reactivate')} ${p.sku}`}
                            title={t('products.reactivate')}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t('products.count', { count: data.total })}</span>
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

      <ProductFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        product={editing}
        categories={categories.data ?? []}
      />
      <LabelsDialog product={labelsFor} onClose={() => setLabelsFor(null)} />
      <ConfirmDialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        onConfirm={() => deactivating && toggleActive.mutate(deactivating)}
        title={t('products.deactivateTitle')}
        message={t('products.deactivateMessage', {
          sku: deactivating?.sku ?? '',
          name: deactivating ? (i18n.language === 'fi' && deactivating.nameFi ? deactivating.nameFi : deactivating.nameEn) : '',
        })}
        confirmLabel={t('products.deactivate')}
        busy={toggleActive.isPending}
      />
    </div>
  );
}
