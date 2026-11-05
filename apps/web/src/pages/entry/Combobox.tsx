import { useEffect, useId, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';

/**
 * Minimal accessible combobox (ARIA 1.2 list autocomplete): a text input that opens a listbox
 * of suggestions. ArrowUp/ArrowDown move, Enter picks (without submitting the form), Escape closes.
 * The caller owns the text and the option list (client- or server-side filtering).
 */
export function Combobox<T>({
  inputValue,
  onInputChange,
  options,
  getKey,
  renderOption,
  onSelect,
  placeholder,
  ariaLabel,
  statusText,
  disabled,
  invalid,
}: {
  inputValue: string;
  onInputChange: (value: string) => void;
  options: T[];
  getKey: (option: T) => string | number;
  renderOption: (option: T) => React.ReactNode;
  onSelect: (option: T) => void;
  placeholder?: string;
  ariaLabel: string;
  /** Shown inside the open list instead of options (loading / no matches); omit for nothing. */
  statusText?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  // keep the highlighted option valid when the list changes
  useEffect(() => {
    setActive((i) => (i >= options.length ? options.length - 1 : i));
  }, [options.length]);

  // scroll the highlighted option into view while navigating with the keyboard
  useEffect(() => {
    if (active < 0 || !listRef.current) return;
    const el = listRef.current.children[active] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const showList = open && !disabled && (options.length > 0 || Boolean(statusText));

  const pick = (option: T) => {
    onSelect(option);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (options.length === 0 ? -1 : Math.min(options.length - 1, i + 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && active < options.length) {
        e.preventDefault();
        pick(options[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        setActive(-1);
      }
    }
  };

  return (
    <div className="relative">
      <Input
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={invalid || undefined}
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={inputValue}
        disabled={disabled}
        onChange={(e) => {
          onInputChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-lg"
        >
          {options.length === 0 ? (
            <li className="px-3 py-1.5 text-xs text-muted-foreground" role="presentation">
              {statusText}
            </li>
          ) : (
            options.map((option, i) => (
              <li
                key={getKey(option)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn(
                  'cursor-pointer px-3 py-1.5 text-sm',
                  i === active ? 'bg-muted text-foreground' : 'hover:bg-muted/60',
                )}
                // keep focus in the input so blur does not close the list before the click lands
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(option)}
              >
                {renderOption(option)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
