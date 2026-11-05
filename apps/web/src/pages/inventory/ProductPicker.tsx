import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, qs } from '@/lib/api';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import { productName, type Product, type ProductList } from './types';

/**
 * Searchable product chooser: a debounced search box feeding a native select
 * (keyboard friendly on desktop and phones). The chosen product always stays listed.
 */
export function ProductPicker({
  value,
  onChange,
  trackedOnly,
  allowAll,
  invalid,
  className,
  label,
}: {
  value: Product | null;
  onChange: (product: Product | null) => void;
  /** Only stock-tracked products (services cannot move stock). */
  trackedOnly?: boolean;
  /** Show an "All products" option (filters). */
  allowAll?: boolean;
  invalid?: boolean;
  className?: string;
  /** Accessible label of the select. */
  label: string;
}) {
  const { t, i18n } = useTranslation('inventory');
  const searchId = useId();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const results = useQuery({
    queryKey: ['products', 'picker', q],
    queryFn: () => api.get<ProductList>('/products' + qs({ q: q || undefined, active: 'true', pageSize: 30 })),
    staleTime: 30_000,
  });

  const options = useMemo(() => {
    const list = (results.data?.products ?? []).filter((p) => !trackedOnly || p.trackStock);
    if (value && !list.some((p) => p.id === value.id)) list.unshift(value);
    return list;
  }, [results.data, trackedOnly, value]);

  return (
    <div className={cn('grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]', className)}>
      <Input
        id={searchId}
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('picker.searchPlaceholder')}
        aria-label={t('picker.search')}
      />
      <Select
        aria-label={label}
        aria-invalid={invalid || undefined}
        className={cn(invalid && 'border-destructive')}
        value={value ? String(value.id) : ''}
        onChange={(e) => {
          const id = Number(e.target.value);
          onChange(options.find((p) => p.id === id) ?? null);
        }}
      >
        <option value="">
          {allowAll
            ? t('picker.all')
            : results.isLoading
              ? t('common:common.loading')
              : options.length === 0
                ? t('picker.noMatches')
                : t('picker.choose')}
        </option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.sku} — {productName(p, i18n.language)}
            {p.stockQty !== null ? ` (${t('picker.inStock', { qty: p.stockQty })})` : ''}
          </option>
        ))}
      </Select>
    </div>
  );
}
