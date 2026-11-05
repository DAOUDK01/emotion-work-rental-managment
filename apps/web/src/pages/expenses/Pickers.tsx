import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, qs } from '@/lib/api';
import { Input, Select } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import { UNIT_LIST_QS, productLabel, type ProductLite, type UnitLite } from './types';

/** Shared unit list (GET /units?pageSize=200, cached). */
export function useUnitList() {
  return useQuery({
    queryKey: ['units', 'list', UNIT_LIST_QS],
    queryFn: () => api.get<{ units: UnitLite[]; total: number }>('/units' + UNIT_LIST_QS),
    staleTime: 60_000,
  });
}

/** Optional unit link as a native select (keyboard + mobile friendly). */
export function UnitSelect({
  value,
  onChange,
  label,
  current,
  emptyLabel,
  className,
}: {
  value: number | null;
  onChange: (unitId: number | null) => void;
  label: string;
  /** Unit already linked (kept listed even when outside the loaded page). */
  current?: { id: number; code: string; brand: string } | null;
  emptyLabel: string;
  className?: string;
}) {
  const { t } = useTranslation('expenses');
  const units = useUnitList();
  const options = useMemo(() => {
    const list: Array<{ id: number; code: string; brand: string }> = [...(units.data?.units ?? [])];
    if (current && !list.some((u) => u.id === current.id)) list.unshift(current);
    return list;
  }, [units.data, current]);

  return (
    <Select
      aria-label={label}
      className={className}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">{units.isLoading ? t('common:common.loading') : units.isError ? t('pickers.unitsFailed') : emptyLabel}</option>
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.code} — {u.brand}
        </option>
      ))}
    </Select>
  );
}

/**
 * Product link for stock receiving: a debounced search box feeding a native select.
 * The chosen product always stays listed.
 */
export function ProductSelect({
  value,
  onChange,
  label,
  invalid,
}: {
  value: ProductLite | null;
  onChange: (product: ProductLite | null) => void;
  label: string;
  invalid?: boolean;
}) {
  const { t, i18n } = useTranslation('expenses');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const results = useQuery({
    queryKey: ['products', 'expense-picker', q],
    queryFn: () =>
      api.get<{ products: ProductLite[]; total: number }>('/products' + qs({ q: q || undefined, active: 'true', pageSize: 30 })),
    staleTime: 30_000,
  });

  const options = useMemo(() => {
    const list = [...(results.data?.products ?? [])];
    if (value && !list.some((p) => p.id === value.id)) list.unshift(value);
    return list;
  }, [results.data, value]);

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('form.productSearch')}
        aria-label={t('form.productSearch')}
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
          {results.isLoading
            ? t('common:common.loading')
            : results.isError
              ? t('pickers.productsFailed')
              : options.length === 0
                ? t('pickers.noProducts')
                : t('pickers.noProduct')}
        </option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {productLabel(p, i18n.language)}
            {p.trackStock
              ? p.stockQty !== null
                ? ` (${t('pickers.inStock', { qty: p.stockQty })})`
                : ''
              : ` (${t('pickers.notTracked')})`}
          </option>
        ))}
      </Select>
    </div>
  );
}
