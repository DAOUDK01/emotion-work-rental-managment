import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { CameraOff } from 'lucide-react';
import { api } from '@/lib/api';
import { euroInputToCents } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import {
  currentVatRateBp,
  errMsg,
  fmtVatRate,
  vatRateOptions,
  type Lookups,
  type ProductRow,
} from './types';

// ---------------------------------------------------------------- camera

/** Camera barcode scanning with @zxing/browser; the stream is released on close. */
export function CameraScanDialog({
  open,
  onClose,
  onCode,
}: {
  open: boolean;
  onClose: () => void;
  onCode: (code: string) => void;
}) {
  const { t } = useTranslation('pos');
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    if (!open) return;
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;
    let handled = false;
    let controls: IScannerControls | null = null;
    setError(null);
    setStarting(true);

    const reader = new BrowserMultiFormatReader();
    reader
      .decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (result, _err, ctl) => {
        if (!result || handled || cancelled) return;
        handled = true;
        ctl.stop();
        onCodeRef.current(result.getText());
      })
      .then((ctl) => {
        if (cancelled) {
          ctl.stop();
          return;
        }
        controls = ctl;
        setStarting(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStarting(false);
        const name = err instanceof Error ? err.name : '';
        setError(
          name === 'NotAllowedError' || name === 'SecurityError'
            ? t('camera.denied')
            : name === 'NotFoundError' || name === 'OverconstrainedError'
              ? t('camera.notFound')
              : t('camera.failed'),
        );
      });

    return () => {
      cancelled = true;
      controls?.stop();
      // Belt and braces: make sure the camera light goes off.
      const stream = video.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [open, t]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('camera.title')}
      footer={
        <Button variant="outline" onClick={onClose}>
          {t('common:action.close')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="relative aspect-video overflow-hidden rounded-md bg-black">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline aria-label={t('camera.title')} />
          {starting ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spinner className="border-white border-t-transparent" />
            </div>
          ) : null}
          {!starting && !error ? (
            <div className="pointer-events-none absolute inset-x-8 top-1/2 h-0.5 -translate-y-1/2 bg-red-500/80" />
          ) : null}
        </div>
        {error ? (
          <p className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive" role="alert">
            <CameraOff className="h-4 w-4 shrink-0" /> {error}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{t('camera.hint')}</p>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- unknown barcode → create product

interface CreateProductForm {
  nameEn: string;
  price: string;
  vatRateBp: string;
  trackStock: boolean;
}

/** 404 UNKNOWN_BARCODE → create a product carrying this barcode, then add it to the cart. */
export function UnknownBarcodeDialog({
  barcode,
  lookups,
  onClose,
  onCreated,
}: {
  barcode: string | null;
  lookups: Lookups | undefined;
  onClose: () => void;
  onCreated: (product: ProductRow) => void;
}) {
  const { t, i18n } = useTranslation('pos');
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        nameEn: z.string().trim().min(1, t('validation.nameRequired')).max(200),
        price: z
          .string()
          .trim()
          .min(1, t('validation.amountRequired'))
          .refine((v) => {
            const c = euroInputToCents(v);
            return c !== null && c >= 0;
          }, t('validation.badAmount')),
        vatRateBp: z.string().min(1),
        trackStock: z.boolean(),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<CreateProductForm>({
    resolver: zodResolver(schema),
    defaultValues: { nameEn: '', price: '', vatRateBp: '2550', trackStock: true },
  });
  const trackStock = watch('trackStock');

  useEffect(() => {
    if (barcode !== null) {
      setCreating(false);
      reset({ nameEn: '', price: '', vatRateBp: String(currentVatRateBp(lookups)), trackStock: true });
    }
  }, [barcode, lookups, reset]);

  const create = useMutation({
    mutationFn: (values: CreateProductForm) =>
      api.post<{ product: ProductRow }>('/products', {
        nameEn: values.nameEn.trim(),
        priceCents: euroInputToCents(values.price) ?? 0,
        vatRateBp: Number(values.vatRateBp),
        trackStock: values.trackStock,
        barcodes: [{ barcode }],
      }),
    onSuccess: ({ product }) => {
      toast.success(t('unknown.created'));
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onCreated(product);
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const onSubmit = handleSubmit((values) => create.mutate(values));

  return (
    <Dialog
      open={barcode !== null}
      onClose={onClose}
      title={t('unknown.title')}
      footer={
        creating ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={create.isPending}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" form="pos-create-product" disabled={create.isPending}>
              {t('unknown.createAndAdd')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('common:action.close')}
            </Button>
            <Button onClick={() => setCreating(true)} autoFocus>
              {t('unknown.create')}
            </Button>
          </>
        )
      }
    >
      <p className="text-sm">
        {t('unknown.message')} <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm">{barcode}</code>
      </p>
      {creating ? (
        <form id="pos-create-product" onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2" noValidate>
          <Field label={t('unknown.name')} error={errors.nameEn?.message} required className="sm:col-span-2">
            <Input autoFocus {...register('nameEn')} />
          </Field>
          <Field label={t('unknown.price')} error={errors.price?.message} required>
            <Input inputMode="decimal" placeholder="0,00" {...register('price')} />
          </Field>
          <Field label={t('common:money.vatRate')} error={errors.vatRateBp?.message} required>
            <Select {...register('vatRateBp')}>
              {vatRateOptions(lookups).map((bp) => (
                <option key={bp} value={bp}>
                  {fmtVatRate(bp, i18n.language)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              label={t('unknown.trackStock')}
              checked={trackStock}
              onChange={(e) => setValue('trackStock', e.target.checked)}
            />
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
