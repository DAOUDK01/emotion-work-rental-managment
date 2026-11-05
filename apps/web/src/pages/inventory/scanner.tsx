import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/misc';

/** Max gap between keystrokes (ms) that still counts as a keyboard-wedge scanner. */
const SCAN_GAP_MS = 50;
const MIN_SCAN_LENGTH = 4;

function isEditable(el: EventTarget | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}

/** Remove the scanned characters a wedge scanner typed into a focused text field (keeps React state in sync). */
function stripScannedText(el: HTMLElement, scanned: string) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (!el.value.endsWith(scanned)) return;
  const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const next = el.value.slice(0, el.value.length - scanned.length);
  if (setter) setter.call(el, next);
  else el.value = next;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

/**
 * Keyboard-wedge barcode scanner listener (see WEB_CONVENTIONS "Special patterns"):
 * buffers printable keys arriving < 50 ms apart; Enter with ≥ 4 buffered chars is a scan.
 * Runs in the capture phase so a scan's Enter never submits a focused form. When an
 * editable field has focus, only the fast-gap signature counts and the scanned text is
 * removed from that field again.
 */
export function useWedgeScanner(onScan: (code: string) => void, enabled = true) {
  const callback = useRef(onScan);
  useEffect(() => {
    callback.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    // Only keys that arrived < SCAN_GAP_MS after the previous one stay in the buffer.
    let buffer = '';
    let last = 0;

    const onKey = (e: KeyboardEvent) => {
      const now = performance.now();
      const gap = now - last;
      last = now;

      if (e.key === 'Enter') {
        const code = buffer;
        buffer = '';
        // scanners send Enter right after the last digit (small tolerance for the suffix key)
        if (code.length < MIN_SCAN_LENGTH || gap >= SCAN_GAP_MS * 2) return;
        e.preventDefault();
        e.stopPropagation();
        if (isEditable(e.target)) stripScannedText(e.target, code);
        const trimmed = code.trim();
        if (trimmed) callback.current(trimmed);
        return;
      }

      if (e.key === 'Shift') return; // scanners press Shift for capitals
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) {
        buffer = '';
        return;
      }

      // a slow key starts a new burst (the first key's gap is unknown, the rest must be fast)
      buffer = buffer === '' || gap >= SCAN_GAP_MS ? e.key : buffer + e.key;
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [enabled]);
}

/**
 * Camera barcode scanner (@zxing/browser) in its own overlay. Starts the camera when
 * opened, stops and releases it on close or after the first successful read.
 * Escape closes only this overlay (it may sit on top of another dialog).
 */
export function CameraScanDialog({
  open,
  onClose,
  onDetected,
}: {
  open: boolean;
  onClose: () => void;
  onDetected: (code: string) => void;
}) {
  const { t } = useTranslation('inventory');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const detected = useRef(onDetected);
  const close = useRef(onClose);
  useEffect(() => {
    detected.current = onDetected;
    close.current = onClose;
  }, [onDetected, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStarting(true);
    const video = videoRef.current;
    if (!video) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError(t('scan.cameraUnsupported'));
      setStarting(false);
      return;
    }
    let cancelled = false;
    let controls: IScannerControls | null = null;
    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromVideoDevice(undefined, video, (result, _err, ctl) => {
        if (!result || cancelled) return;
        cancelled = true;
        ctl.stop();
        detected.current(result.getText().trim());
      })
      .then((c) => {
        setStarting(false);
        if (cancelled) c.stop();
        else controls = c;
      })
      .catch((err: unknown) => {
        setStarting(false);
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'SecurityError') setError(t('scan.cameraDenied'));
        else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError(t('scan.cameraMissing'));
        else setError(t('scan.cameraFailed', { message: err instanceof Error ? err.message : String(err) }));
      });
    return () => {
      cancelled = true;
      controls?.stop();
    };
  }, [open, t]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={t('scan.cameraTitle')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Camera className="h-4 w-4" /> {t('scan.cameraTitle')}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('common:action.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="space-y-3 p-4">
          <div className="relative overflow-hidden rounded-md bg-black">
            <video ref={videoRef} className="aspect-video w-full object-cover" muted playsInline />
            {starting && !error ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <Spinner className="border-white border-t-transparent" />
              </div>
            ) : null}
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          </div>
          {error ? (
            <p className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" role="alert">
              {error}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('scan.cameraHint')}</p>
          )}
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              {t('common:action.close')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
