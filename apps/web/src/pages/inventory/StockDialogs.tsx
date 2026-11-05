import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Label, Select, Textarea } from '@/components/ui/input';
import { ProductPicker } from './ProductPicker';
import { fmtSignedQty, productName, type Product, type UnitLight } from './types';

function StockLine({ product, delta }: { product: Product | null; delta: number | null }) {
  const { t } = useTranslation('inventory');
  if (!product || product.stockQty === null) return null;
  const after = delta !== null ? product.stockQty + delta : null;
  return (
    <p className="text-xs text-muted-foreground" aria-live="polite">
      {t('stockDialogs.currentStock', { qty: product.stockQty })}
      {after !== null ? (
        <>
          {' → '}
          <span className={after < 0 ? 'font-semibold text-loss' : 'font-semibold text-foreground'}>
            {t('stockDialogs.afterStock', { qty: after })}
          </span>
        </>
      ) : null}
    </p>
  );
}

interface AdjustValues {
  qty: string;
  reason: string;
  notes: string;
}

/** Counted stock correction: signed qty + REQUIRED reason (API rejects a missing reason). */
export function AdjustDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [productError, setProductError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        qty: z
          .string()
          .trim()
          .regex(/^[+\-−]?\d{1,6}$/, t('stockDialogs.badSignedQty'))
          .refine((v) => Number(v.replace('−', '-')) !== 0, t('stockDialogs.zeroQty')),
        reason: z.string().trim().min(1, t('stockDialogs.reasonRequired')).max(500),
        notes: z.string().trim().max(2000),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AdjustValues>({ resolver: zodResolver(schema), defaultValues: { qty: '', reason: '', notes: '' } });

  useEffect(() => {
    if (open) {
      reset({ qty: '', reason: '', notes: '' });
      setProduct(null);
      setProductError(null);
    }
  }, [open, reset]);

  const qtyText = watch('qty').trim().replace('−', '-');
  const delta = /^[+-]?\d{1,6}$/.test(qtyText) ? Number(qtyText) : null;

  const mutation = useMutation({
    mutationFn: (v: AdjustValues) =>
      api.post<{ product: Product }>('/stock/adjust', {
        productId: product!.id,
        qty: Number(v.qty.trim().replace('−', '-')),
        reason: v.reason.trim(),
        notes: v.notes.trim() || null,
      }),
    onSuccess: ({ product: updated }) => {
      toast.success(t('stockDialogs.adjustedOk', { name: productName(updated, i18n.language), qty: updated.stockQty ?? 0 }));
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = handleSubmit((v) => {
    if (!product) {
      setProductError(t('stockDialogs.productRequired'));
      return;
    }
    mutation.mutate(v);
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('stockDialogs.adjustTitle')} wide>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <Label>
            {t('receiving.product')}
            <span className="ml-0.5 text-destructive">*</span>
          </Label>
          <ProductPicker
            label={t('receiving.product')}
            value={product}
            onChange={(p) => {
              setProduct(p);
              setProductError(null);
            }}
            trackedOnly
            invalid={!!productError}
          />
          {productError ? <p className="text-2xs font-medium text-destructive">{productError}</p> : null}
          <StockLine product={product} delta={delta} />
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label={t('stockDialogs.signedQty')} error={errors.qty?.message} hint={t('stockDialogs.signedQtyHint')} required>
            <Input inputMode="text" placeholder="-2" autoComplete="off" {...register('qty')} />
          </Field>
          <Field label={t('stockDialogs.reason')} error={errors.reason?.message} required>
            <Input placeholder={t('stockDialogs.reasonPlaceholder')} {...register('reason')} />
          </Field>
        </div>
        <Field label={t('common:common.notes')} error={errors.notes?.message}>
          <Textarea rows={2} {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {delta !== null && delta !== 0
              ? t('stockDialogs.adjustSubmit', { qty: fmtSignedQty(delta) })
              : t('stockDialogs.adjustSubmitPlain')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface RepairValues {
  qty: string;
  unitId: string;
  notes: string;
}

/** Parts used in a repair: REPAIR_USE movement (−qty), optionally booked against a unit. */
export function RepairUseDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [product, setProduct] = useState<Product | null>(null);
  const [productError, setProductError] = useState<string | null>(null);

  const units = useQuery({
    queryKey: ['units', 'list-light'],
    queryFn: () => api.get<{ units: UnitLight[] }>('/units' + qs({ pageSize: 200 })),
    staleTime: 60_000,
    enabled: open,
  });

  const schema = useMemo(
    () =>
      z.object({
        qty: z.string().trim().regex(/^[1-9]\d{0,5}$/, t('receiving.badQty')),
        unitId: z.string(),
        notes: z.string().trim().max(2000),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<RepairValues>({ resolver: zodResolver(schema), defaultValues: { qty: '1', unitId: '', notes: '' } });

  useEffect(() => {
    if (open) {
      reset({ qty: '1', unitId: '', notes: '' });
      setProduct(null);
      setProductError(null);
    }
  }, [open, reset]);

  const qtyText = watch('qty').trim();
  const delta = /^[1-9]\d{0,5}$/.test(qtyText) ? -Number(qtyText) : null;
  const short = product?.stockQty != null && delta !== null && product.stockQty + delta < 0;

  const mutation = useMutation({
    mutationFn: (v: RepairValues) =>
      api.post<{ product: Product }>('/stock/repair-use', {
        productId: product!.id,
        qty: Number(v.qty.trim()),
        unitId: v.unitId === '' ? null : Number(v.unitId),
        notes: v.notes.trim() || null,
      }),
    onSuccess: ({ product: updated }) => {
      toast.success(t('stockDialogs.repairOk', { name: productName(updated, i18n.language), qty: updated.stockQty ?? 0 }));
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const submit = handleSubmit((v) => {
    if (!product) {
      setProductError(t('stockDialogs.productRequired'));
      return;
    }
    mutation.mutate(v);
  });

  return (
    <Dialog open={open} onClose={onClose} title={t('stockDialogs.repairTitle')} wide>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="space-y-1.5">
          <Label>
            {t('stockDialogs.part')}
            <span className="ml-0.5 text-destructive">*</span>
          </Label>
          <ProductPicker
            label={t('stockDialogs.part')}
            value={product}
            onChange={(p) => {
              setProduct(p);
              setProductError(null);
            }}
            trackedOnly
            invalid={!!productError}
          />
          {productError ? <p className="text-2xs font-medium text-destructive">{productError}</p> : null}
          <StockLine product={product} delta={delta} />
          {short ? (
            <p className="text-2xs font-medium text-amber-700 dark:text-amber-400" role="alert">
              {t('stockDialogs.shortWarning')}
            </p>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
          <Field label={t('receiving.qty')} error={errors.qty?.message} required>
            <Input inputMode="numeric" {...register('qty')} />
          </Field>
          <Field label={t('stockDialogs.unit')} error={errors.unitId?.message} hint={t('stockDialogs.unitHint')}>
            <Select {...register('unitId')}>
              <option value="">{units.isLoading ? t('common:common.loading') : t('stockDialogs.noUnit')}</option>
              {(units.data?.units ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} — {u.brand}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {units.isError ? <p className="text-2xs text-destructive">{t('stockDialogs.unitsFailed')}</p> : null}
        <Field label={t('common:common.notes')} error={errors.notes?.message}>
          <Textarea rows={2} placeholder={t('stockDialogs.repairNotesPlaceholder')} {...register('notes')} />
        </Field>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {t('stockDialogs.repairSubmit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
