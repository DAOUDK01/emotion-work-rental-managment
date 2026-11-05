import { forwardRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Camera, PackageX } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { cn } from '@/components/ui/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { productName, type ProductListResponse, type ProductRow } from './types';

/**
 * Left POS pane: product search + a grid of 24 quick products.
 * Keyboard: arrows move the highlight, Enter adds the highlighted product.
 */
export const ProductPane = forwardRef<
  HTMLInputElement,
  {
    search: string;
    onSearchChange: (v: string) => void;
    onAdd: (product: ProductRow) => void;
    onOpenCamera: () => void;
  }
>(function ProductPane({ search, onSearchChange, onAdd, onOpenCamera }, searchRef) {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const [q, setQ] = useState('');
  const [highlight, setHighlight] = useState(0);

  // Debounced search per WEB_CONVENTIONS.
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const products = useQuery({
    queryKey: ['products', 'pos-grid', q],
    queryFn: () =>
      api.get<ProductListResponse>('/products' + qs({ pageSize: 24, active: true, q: q || undefined })),
    staleTime: 30_000,
  });
  const rows = products.data?.products ?? [];

  useEffect(() => {
    setHighlight(0);
  }, [q, products.data]);

  const move = (delta: number) => {
    if (rows.length === 0) return;
    setHighlight((h) => (h + delta + rows.length) % rows.length);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // A scanner Enter is consumed by the global wedge listener (capture phase).
    if (e.nativeEvent.defaultPrevented) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const product = rows[highlight];
      if (product) onAdd(product);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex gap-2">
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('search.placeholder')}
          aria-label={t('search.placeholder')}
          className="h-11 text-base"
          autoFocus
        />
        <Button variant="outline" size="pos" className="h-11 shrink-0 px-4" onClick={onOpenCamera}>
          <Camera className="h-5 w-5" />
          <span className="hidden sm:inline">{t('actions.camera')}</span>
        </Button>
      </div>

      {products.isLoading ? <LoadingState label={t('common:common.loading')} /> : null}
      {products.isError ? (
        <ErrorState error={products.error} onRetry={() => void products.refetch()} />
      ) : null}
      {products.isSuccess && rows.length === 0 ? (
        <EmptyState title={t('search.noResults')} hint={t('search.noResultsHint')} />
      ) : null}

      {rows.length > 0 ? (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4"
          role="listbox"
          aria-label={t('search.gridLabel')}
        >
          {rows.map((p, i) => {
            const out = p.trackStock && (p.stockQty ?? 0) <= 0;
            return (
              <button
                key={p.id}
                role="option"
                aria-selected={i === highlight}
                onClick={() => onAdd(p)}
                onFocus={() => setHighlight(i)}
                className={cn(
                  'flex min-h-[5.5rem] flex-col items-start justify-between gap-1 rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-ring/60 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  i === highlight && 'border-primary ring-1 ring-primary',
                )}
              >
                <span className="line-clamp-2 text-sm font-medium leading-snug">
                  {productName(p, lang)}
                </span>
                <span className="flex w-full items-center justify-between gap-1">
                  <span className="text-sm font-bold tabular-nums">{fmtEUR(p.priceCents)}</span>
                  {p.trackStock ? (
                    out ? (
                      <Badge variant="danger">
                        <PackageX className="h-3 w-3" /> {t('product.out')}
                      </Badge>
                    ) : (
                      <Badge variant={p.lowStock ? 'warning' : 'default'}>
                        {t('product.stock', { qty: p.stockQty ?? 0 })}
                      </Badge>
                    )
                  ) : (
                    <Badge variant="info">{t('product.service')}</Badge>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
});
