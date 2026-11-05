import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link2, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { Combobox } from './Combobox';
import type { CustomerLite, UnitLite } from './types';

const UNIT_LIST_QS = qs({ pageSize: 200 });
const MAX_UNIT_SUGGESTIONS = 50;

function unitText(u: UnitLite): string {
  return [u.brand, u.modelName].filter(Boolean).join(' ');
}

/** The unit list used by both forms (one cached request: GET /units?pageSize=200). */
export function useUnitList() {
  return useQuery({
    queryKey: ['units', 'list', UNIT_LIST_QS],
    queryFn: () => api.get<{ units: UnitLite[]; total: number }>('/units' + UNIT_LIST_QS),
    staleTime: 60_000,
  });
}

/** Optional unit: searchable select, filtered client-side by code / brand / model as you type. */
export function UnitPicker({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (unitId: number | null) => void;
  label: string;
}) {
  const { t } = useTranslation('entry');
  const units = useUnitList();
  const [text, setText] = useState('');

  const all = units.data?.units ?? [];
  const selected = value !== null ? all.find((u) => u.id === value) : undefined;

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    const list = q
      ? all.filter(
          (u) =>
            u.code.toLowerCase().includes(q) ||
            u.brand.toLowerCase().includes(q) ||
            (u.modelName ?? '').toLowerCase().includes(q),
        )
      : all;
    return list.slice(0, MAX_UNIT_SUGGESTIONS);
  }, [all, text]);

  if (value !== null) {
    return (
      <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1">
        <Badge variant="navy">{selected?.code ?? `#${value}`}</Badge>
        {selected ? <span className="truncate text-sm text-muted-foreground">{unitText(selected)}</span> : null}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2"
          onClick={() => {
            onChange(null);
            setText('');
          }}
          aria-label={t('pickers.clearUnit')}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <Combobox
        ariaLabel={label}
        placeholder={t('pickers.unitPlaceholder')}
        inputValue={text}
        onInputChange={setText}
        options={matches}
        getKey={(u) => u.id}
        renderOption={(u) => (
          <span className="flex items-baseline gap-2">
            <span className="font-medium">{u.code}</span>
            <span className="truncate text-xs text-muted-foreground">{unitText(u)}</span>
          </span>
        )}
        onSelect={(u) => {
          onChange(u.id);
          setText('');
        }}
        statusText={
          units.isLoading ? t('pickers.loadingUnits') : units.isError ? undefined : t('pickers.noUnits')
        }
        disabled={units.isError}
      />
      {units.isError ? (
        <p className="flex flex-wrap items-center gap-2 text-2xs font-medium text-destructive" role="alert">
          {t('pickers.unitsFailed')}
          <Button variant="link" size="sm" className="h-auto p-0 text-2xs" onClick={() => void units.refetch()}>
            {t('common:action.retry')}
          </Button>
        </p>
      ) : null}
    </div>
  );
}

/**
 * Customer: free-text name, with an optional link to a saved customer found via
 * GET /customers?q= (debounced, from 2 characters).
 */
export function CustomerPicker({
  name,
  onNameChange,
  linked,
  onLinkedChange,
  label,
}: {
  name: string;
  onNameChange: (name: string) => void;
  linked: CustomerLite | null;
  onLinkedChange: (customer: CustomerLite | null) => void;
  label: string;
}) {
  const { t } = useTranslation('entry');
  const [q, setQ] = useState('');

  useEffect(() => {
    const h = setTimeout(() => setQ(name.trim()), 300);
    return () => clearTimeout(h);
  }, [name]);

  const search = useQuery({
    queryKey: ['customers', 'search', q],
    queryFn: () => api.get<{ customers: CustomerLite[]; total: number }>('/customers' + qs({ q, pageSize: 8 })),
    enabled: !linked && q.length >= 2,
    staleTime: 30_000,
  });

  if (linked) {
    return (
      <div className="flex min-h-9 flex-wrap items-center gap-2 rounded-md border border-input bg-card px-2.5 py-1">
        <Link2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{linked.name}</span>
        <Badge variant={linked.type === 'BUSINESS' ? 'info' : 'default'}>{t(`customerType.${linked.type}`)}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs"
          onClick={() => {
            onLinkedChange(null);
            onNameChange('');
          }}
        >
          <X className="h-3.5 w-3.5" /> {t('pickers.unlink')}
        </Button>
      </div>
    );
  }

  const typing = name.trim().length >= 2;
  const results = typing && q === name.trim() ? (search.data?.customers ?? []) : [];
  const status = !typing
    ? undefined
    : search.isFetching || q !== name.trim()
      ? t('pickers.searching')
      : search.isError
        ? t('pickers.customersFailed')
        : t('pickers.noCustomers');

  return (
    <Combobox
      ariaLabel={label}
      placeholder={t('pickers.customerPlaceholder')}
      inputValue={name}
      onInputChange={onNameChange}
      options={results}
      getKey={(c) => c.id}
      renderOption={(c) => (
        <span className="flex items-center justify-between gap-2">
          <span>{c.name}</span>
          <span className="text-2xs text-muted-foreground">{t(`customerType.${c.type}`)}</span>
        </span>
      )}
      onSelect={(c) => {
        onLinkedChange(c);
        onNameChange('');
      }}
      statusText={status}
    />
  );
}
