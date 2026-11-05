import { useEffect, useRef } from 'react';

/** Keyboard-wedge barcode scanners "type" very fast and finish with Enter. */
const MAX_KEY_GAP_MS = 50;
const MAX_ENTER_GAP_MS = 100;
const MIN_CODE_LENGTH = 4;

type TextField = HTMLInputElement | HTMLTextAreaElement;

function focusedTextField(): TextField | null {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return el;
  if (el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)) return el;
  return null;
}

/**
 * When a scan lands while a text field has focus, the scanner already typed the code
 * into it — remove those characters again (React-compatible native setter + input event).
 */
function stripScannedText(field: TextField, code: string): void {
  if (!field.value.endsWith(code)) return;
  const proto = field instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) return;
  setter.call(field, field.value.slice(0, field.value.length - code.length));
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Global keyboard-wedge scanner listener (capture phase on window).
 * Printable keys with inter-key gaps < 50 ms are buffered; Enter with ≥ 4 buffered
 * characters is a scan: the buffer is cleared, the Enter is swallowed and `onScan`
 * fires. Human typing never matches the gap signature, so focused inputs stay usable.
 */
export function useWedgeScanner(onScan: (code: string) => void, enabled = true): void {
  const handler = useRef(onScan);
  useEffect(() => {
    handler.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    let buffer = '';
    let lastAt = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      const now = performance.now();
      const gap = now - lastAt;
      lastAt = now;

      if (e.key === 'Shift') return; // scanners press Shift for upper-case characters
      if (e.key === 'Enter') {
        const code = buffer;
        buffer = '';
        if (code.length >= MIN_CODE_LENGTH && gap < MAX_ENTER_GAP_MS) {
          e.preventDefault();
          e.stopPropagation();
          const field = focusedTextField();
          if (field) stripScannedText(field, code);
          handler.current(code);
        }
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
        buffer = '';
        return;
      }
      buffer = buffer && gap < MAX_KEY_GAP_MS ? buffer + e.key : e.key;
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [enabled]);
}
