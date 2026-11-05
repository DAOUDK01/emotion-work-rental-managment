import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/utils';

export interface MenuItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
}

interface MenuPos {
  right: number;
  top?: number;
  bottom?: number;
}

const MENU_HEIGHT_GUESS = 220;

/**
 * Row "⋯" menu. Rendered with position:fixed so the table's overflow container never clips it.
 * Keyboard: Enter/Space/ArrowDown opens, arrows move, Home/End jump, Esc/Tab closes.
 */
export default function RowActionsMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [pos, setPos] = useState<MenuPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const open = pos !== null;

  const close = useCallback((restoreFocus: boolean) => {
    setPos(null);
    if (restoreFocus) buttonRef.current?.focus();
  }, []);

  const openMenu = () => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(
      r.bottom + MENU_HEIGHT_GUESS > window.innerHeight && r.top > MENU_HEIGHT_GUESS
        ? { right, bottom: window.innerHeight - r.top + 4 }
        : { right, top: r.bottom + 4 },
    );
  };

  const enabledItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? []),
    [],
  );

  // focus the first item on open; close on outside click / scroll / resize
  useEffect(() => {
    if (!open) return;
    enabledItems()[0]?.focus();
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) close(false);
    };
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, close, enabledItems]);

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const list = enabledItems();
    if (list.length === 0) return;
    const idx = list.findIndex((el) => el === document.activeElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list[(idx + 1) % list.length].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      list[(idx - 1 + list.length) % list.length].focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      list[0].focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      list[list.length - 1].focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </Button>
      {pos ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={onMenuKeyDown}
          className="fixed z-40 min-w-[11rem] overflow-hidden rounded-md border bg-card py-1 shadow-lg"
          style={{ right: pos.right, top: pos.top, bottom: pos.bottom }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50',
                item.destructive && 'text-destructive',
              )}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden>
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}
