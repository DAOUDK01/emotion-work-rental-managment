import { useEffect, useRef } from 'react';

/** Keyboard-wedge scanners "type" the code very fast and finish with Enter. */
const MAX_KEY_GAP_MS = 50;
const MAX_ENTER_GAP_MS = 100;
const MIN_LENGTH = 4;

/**
 * Global keyboard-wedge barcode listener (WEB_CONVENTIONS "Special patterns").
 * Printable keys whose inter-key gap is < 50 ms are buffered; Enter with ≥ 4 buffered
 * characters is treated as a scan: the buffer is cleared, the Enter is swallowed
 * (preventDefault) and `onScan(code)` runs. Human typing never satisfies the gap
 * signature, so editable fields keep working normally. Cleaned up on unmount.
 */
export function useBarcodeWedge(onScan: (code: string) => void, enabled: boolean): void {
  const callback = useRef(onScan);
  useEffect(() => {
    callback.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let last = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        buffer = '';
        return;
      }
      const now = performance.now();
      const gap = now - last;

      if (e.key === 'Enter') {
        const code = buffer.trim();
        const looksScanned = code.length >= MIN_LENGTH && gap < MAX_ENTER_GAP_MS;
        buffer = '';
        last = now;
        if (looksScanned) {
          e.preventDefault();
          e.stopPropagation();
          callback.current(code);
        }
        return;
      }

      // Shift / CapsLock etc. arrive between characters on some scanners — ignore them.
      if (e.key.length !== 1) return;
      if (buffer && gap >= MAX_KEY_GAP_MS) buffer = '';
      buffer += e.key;
      last = now;
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}

/** True when the element accepts typed text (inputs, textareas, selects, contenteditable). */
export function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return (el as HTMLElement).isContentEditable;
}
