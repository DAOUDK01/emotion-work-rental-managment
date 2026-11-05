import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, Spinner } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import type { CustomerHit, CustomerType } from './types';

export interface PickedCustomer {
  id: number;
  name: string;
  type: CustomerType;
}

/**
 * Optional customer picker with server-side search (name, email, Business ID).
 * Keyboard: ↓/↑ move, Enter picks, Escape closes the list (without closing the dialog).
 */
export function CustomerSearch({
  id,
  value,
  onChange,
  disabled,
}: {
  id?: string;
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation('claims');
  const listId = useId();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(timer);
  }, [term]);

  const results = useQuery({
    queryKey: ['customers', 'list', 'claim-picker', debounced],
    queryFn: async () =>
      (
        await api.get<{ customers: CustomerHit[] }>(
          '/customers' + qs({ q: debounced || undefined, archived: 'false', pageSize: 10 }),
        )
      ).customers,
    enabled: open && !value,
    staleTime: 30_000,
  });

  const hits = results.data ?? [];

  useEffect(() => setActive(0), [debounced]);

  const pick = (c: CustomerHit) => {
    onChange({ id: c.id, name: c.name, type: c.type });
    setTerm('');
    setOpen(false);
  };

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-input bg-card pl-3 pr-1 text-sm shadow-sm">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{value.name}</span>
          <Badge variant={value.type === 'BUSINESS' ? 'info' : 'default'}>{t(`customerType.${value.type}`)}</Badge>
        </div>
        {disabled ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label={t('form.clearCustomer')}
            onClick={() => onChange(null)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label={t('form.customer')}
        aria-activedescendant={open && hits[active] ? `${listId}-${hits[active].id}` : undefined}
        autoComplete="off"
        className="pl-8"
        placeholder={t('form.customerSearch')}
        value={term}
        disabled={disabled}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            if (open && hits[active]) {
              e.preventDefault();
              pick(hits[active]);
            }
          } else if (e.key === 'Escape' && open) {
            // keep the surrounding dialog open; only close the suggestion list
            e.stopPropagation();
            e.nativeEvent.stopImmediatePropagation();
            setOpen(false);
          }
        }}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={t('form.customer')}
          className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-card py-1 text-sm shadow-lg"
        >
          {results.isLoading ? (
            <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
              <Spinner className="h-4 w-4" /> {t('form.searching')}
            </li>
          ) : results.isError ? (
            <li className="px-3 py-2 text-xs text-destructive">{t('form.customerSearchFailed')}</li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted-foreground">{t('form.noCustomers')}</li>
          ) : (
            hits.map((c, i) => (
              <li
                key={c.id}
                id={`${listId}-${c.id}`}
                role="option"
                aria-selected={i === active}
                className={cn('cursor-pointer px-3 py-1.5', i === active ? 'bg-muted' : 'hover:bg-muted/60')}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(c);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  <Badge variant={c.type === 'BUSINESS' ? 'info' : 'default'}>{t(`customerType.${c.type}`)}</Badge>
                </div>
                {c.businessId || c.email || c.city ? (
                  <div className="truncate text-2xs text-muted-foreground">
                    {[c.businessId, c.email, c.city].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
