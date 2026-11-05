import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import JsBarcode from 'jsbarcode';
import { internalProductCode } from '@emotionfix/shared';
import { Camera, Plus, ScanLine, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { CameraScanDialog, useWedgeScanner } from './scanner';
import { checkBarcode, type BarcodeType } from './types';

export interface DraftBarcode {
  barcode: string;
  type: BarcodeType;
}

/** Code128 preview of the primary barcode (or the internal EMF code labels fall back to). */
function BarcodePreview({ code, internal }: { code: string; internal: boolean }) {
  const { t } = useTranslation('inventory');
  const svgRef = useRef<SVGSVGElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, code, {
        format: 'CODE128',
        height: 48,
        width: 1.6,
        fontSize: 12,
        margin: 6,
        displayValue: true,
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [code]);

  return (
    <div className="space-y-1">
      <div className="flex min-h-[80px] items-center justify-center overflow-x-auto rounded-md border bg-white p-2">
        {failed ? (
          <p className="text-xs text-destructive">{t('barcodes.previewFailed')}</p>
        ) : (
          <svg ref={svgRef} role="img" aria-label={t('barcodes.previewLabel', { code })} />
        )}
      </div>
      <p className="text-2xs text-muted-foreground">
        {internal ? t('barcodes.internalPreview') : t('barcodes.primaryPreview')}
      </p>
    </div>
  );
}

/**
 * Barcode list editor for the product dialog: add by typing, keyboard-wedge scan
 * (active while `active` is true) or camera. 13-digit codes must pass EAN-13.
 */
export function BarcodeEditor({
  value,
  onChange,
  productId,
  active,
  pendingRef,
}: {
  value: DraftBarcode[];
  onChange: (next: DraftBarcode[]) => void;
  productId: number | null;
  active: boolean;
  /** Exposes the not-yet-added input so the dialog can add it on save. */
  pendingRef: React.MutableRefObject<() => DraftBarcode[] | null>;
}) {
  const { t } = useTranslation('inventory');
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  useEffect(() => {
    if (!active) {
      setDraft('');
      setError(null);
      setArmed(false);
      setCameraOpen(false);
    }
  }, [active]);

  /** Validate + append; returns the new list, or null (with an inline error) when rejected. */
  const add = useCallback(
    (raw: string): DraftBarcode[] | null => {
      const code = raw.trim();
      const check = checkBarcode(code);
      if (!check.ok) {
        setError(
          check.reason === 'ean'
            ? t('barcodes.badEan', { code })
            : check.reason === 'chars'
              ? t('barcodes.badChars')
              : check.reason === 'long'
                ? t('barcodes.tooLong')
                : t('barcodes.empty'),
        );
        return null;
      }
      if (value.some((b) => b.barcode === code)) {
        setError(t('barcodes.duplicate', { code }));
        return null;
      }
      if (value.length >= 20) {
        setError(t('barcodes.tooMany'));
        return null;
      }
      const next = [...value, { barcode: code, type: check.type }];
      onChange(next);
      setDraft('');
      setError(null);
      setArmed(false);
      return next;
    },
    [value, onChange, t],
  );

  // the dialog calls this on save: include a typed-but-not-added code, block (null) when invalid
  useEffect(() => {
    pendingRef.current = () => (draft.trim() === '' ? value : add(draft));
  }, [pendingRef, draft, add, value]);

  useWedgeScanner((code) => void add(code), active && !cameraOpen);

  const remove = (code: string) => onChange(value.filter((b) => b.barcode !== code));
  const makePrimary = (code: string) => {
    const hit = value.find((b) => b.barcode === code);
    if (!hit) return;
    onChange([hit, ...value.filter((b) => b.barcode !== code)]);
  };

  const primary = value[0]?.barcode ?? (productId ? internalProductCode(productId) : null);

  return (
    <div className="space-y-2">
      <Label>{t('barcodes.title')}</Label>
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('barcodes.none')}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {value.map((b, i) => (
            <li key={b.barcode} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="font-mono text-sm">{b.barcode}</span>
              <Badge variant={b.type === 'EAN13' ? 'info' : 'default'}>{t(`barcodeType.${b.type}`)}</Badge>
              {i === 0 ? <Badge variant="navy">{t('barcodes.primary')}</Badge> : null}
              <div className="ml-auto flex gap-1">
                {i > 0 ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => makePrimary(b.barcode)}
                    aria-label={t('barcodes.makePrimary', { code: b.barcode })}
                    title={t('barcodes.makePrimary', { code: b.barcode })}
                  >
                    <Star className="h-3.5 w-3.5" />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => remove(b.barcode)}
                  aria-label={t('barcodes.remove', { code: b.barcode })}
                  title={t('barcodes.remove', { code: b.barcode })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <Input
          ref={inputRef}
          className="min-w-0 flex-1 font-mono"
          value={draft}
          inputMode="text"
          autoComplete="off"
          placeholder={t('barcodes.addPlaceholder')}
          aria-label={t('barcodes.addLabel')}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            }
          }}
        />
        <Button variant="outline" onClick={() => add(draft)} disabled={draft.trim() === ''}>
          <Plus className="h-3.5 w-3.5" /> {t('common:action.add')}
        </Button>
        <Button
          variant={armed ? 'secondary' : 'outline'}
          aria-pressed={armed}
          onClick={() => {
            setArmed(true);
            inputRef.current?.focus();
          }}
        >
          <ScanLine className="h-3.5 w-3.5" /> {t('scan.scan')}
        </Button>
        <Button variant="outline" size="icon" onClick={() => setCameraOpen(true)} aria-label={t('scan.camera')} title={t('scan.camera')}>
          <Camera className="h-4 w-4" />
        </Button>
      </div>
      {error ? (
        <p className="text-2xs font-medium text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p className={armed ? 'animate-pulse text-2xs font-medium text-primary' : 'text-2xs text-muted-foreground'} aria-live="polite">
          {armed ? t('scan.waiting') : t('barcodes.hint')}
        </p>
      )}

      {primary ? (
        <BarcodePreview code={primary} internal={value.length === 0} />
      ) : (
        <p className="rounded-md border border-dashed px-3 py-2 text-2xs text-muted-foreground">{t('barcodes.internalAfterSave')}</p>
      )}

      <CameraScanDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(code) => {
          setCameraOpen(false);
          add(code);
        }}
      />
    </div>
  );
}
