import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';

interface SearchComboboxProps<T> {
  id?: string;
  placeholder: string;
  ariaLabel: string;
  queryKey: (term: string) => readonly unknown[];
  fetcher: (term: string) => Promise<T[]>;
  itemKey: (item: T) => string | number;
  renderItem: (item: T) => React.ReactNode;
  onPick: (item: T) => void;
  /** Enter pressed while nothing is highlighted (e.g. a barcode typed by hand). */
  onEnterNoMatch?: (term: string) => void;
  emptyText: string;
  invalid?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/** Accessible search-as-you-type combobox (debounced query, arrow keys, Enter, Esc). */
export function SearchCombobox<T>({
  id,
  placeholder,
  ariaLabel,
  queryKey,
  fetcher,
  itemKey,
  renderItem,
  onPick,
  onEnterNoMatch,
  emptyText,
  invalid,
  autoFocus,
  className,
}: SearchComboboxProps<T>) {
  const { t } = useTranslation('invoices');
  const listId = useId();
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(handle);
  }, [term]);

  const results = useQuery({
    queryKey: queryKey(debounced),
    queryFn: () => fetcher(debounced),
    enabled: open,
    staleTime: 30_000,
  });
  const items = results.data ?? [];

  useEffect(() => {
    setHighlight(0);
  }, [debounced]);

  const pick = (item: T) => {
    onPick(item);
    setTerm('');
    setDebounced('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.defaultPrevented) return; // consumed by the barcode-scanner listener
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (items.length) setHighlight((h) => (h + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) setHighlight((h) => (h - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const stale = term.trim() !== debounced;
      if (open && !stale && items[highlight]) pick(items[highlight]);
      else if (onEnterNoMatch && term.trim()) {
        onEnterNoMatch(term.trim());
        setTerm('');
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const activeId = open && items[highlight] ? `${listId}-${String(itemKey(items[highlight]))}` : undefined;

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
      <Input
        id={id}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        className={cn('pl-8', invalid && 'border-destructive')}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card py-1 text-sm shadow-lg"
        >
          {results.isLoading ? (
            <li className="flex items-center gap-2 px-3 py-2 text-muted-foreground">
              <Spinner className="h-4 w-4" /> {t('common:common.loading')}
            </li>
          ) : results.isError ? (
            <li className="px-3 py-2 text-destructive">{t('search.failed')}</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">{emptyText}</li>
          ) : (
            items.map((item, i) => (
              <li
                key={itemKey(item)}
                id={`${listId}-${String(itemKey(item))}`}
                role="option"
                aria-selected={i === highlight}
                className={cn(
                  'cursor-pointer px-3 py-2',
                  i === highlight ? 'bg-muted' : 'hover:bg-muted/60',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(item)}
              >
                {renderItem(item)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
