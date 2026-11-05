import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, qs } from '@/lib/api';
import { euroInputToCents, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import type { Unit, UnitsLookups } from './types';

interface FormValues {
  price: string;
  soldDate: string;
  buyer: string;
  receivedById: string;
  paymentMethodId: string;
  vatInvoice: boolean;
}

interface SellResponse {
  unit: Unit;
  saleProfitCents: number | null;
}

/** Sell a unit: creates the UNIT_SALES income entry on the API side. */
export default function UnitSellDialog({
  open,
  onClose,
  unit,
  lookups,
}: {
  open: boolean;
  onClose: () => void;
  unit: Unit | null;
  lookups: UnitsLookups | undefined;
}) {
  const { t } = useTranslation('units');
  const queryClient = useQueryClient();
  const [buyerCustomerId, setBuyerCustomerId] = useState<number | null>(null);
  const [buyerQuery, setBuyerQuery] = useState('');

  const schema = useMemo(
    () =>
      z.object({
        price: z
          .string()
          .trim()
          .min(1, t('sell.priceRequired'))
          .refine((v) => euroInputToCents(v) !== null, t('form.badAmount')),
        soldDate: z.string().min(1, t('sell.dateRequired')),
        buyer: z.string().trim().max(120),
        receivedById: z.string().min(1, t('sell.receiverRequired')),
        paymentMethodId: z.string(),
        vatInvoice: z.boolean(),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      price: '',
      soldDate: todayInHelsinki(),
      buyer: '',
      receivedById: '',
      paymentMethodId: '',
      vatInvoice: true,
    },
  });

  useEffect(() => {
    if (open) {
      reset({
        price: '',
        soldDate: todayInHelsinki(),
        buyer: '',
        receivedById: '',
        paymentMethodId: '',
        vatInvoice: true,
      });
      setBuyerCustomerId(null);
      setBuyerQuery('');
    }
  }, [open, reset]);

  // Debounced buyer search against /customers.
  const buyerText = watch('buyer');
  useEffect(() => {
    const handle = setTimeout(() => setBuyerQuery(buyerText.trim()), 300);
    return () => clearTimeout(handle);
  }, [buyerText]);
  const customers = useQuery({
    queryKey: ['customers', 'search', buyerQuery],
    queryFn: () =>
      api.get<{ customers: Array<{ id: number; name: string }> }>(
        '/customers' + qs({ q: buyerQuery, pageSize: 8 }),
      ),
    enabled: open && buyerCustomerId === null && buyerQuery.length >= 2,
    staleTime: 30_000,
  });

  // VAT-invoice default follows the receiver (user can still override).
  const receivedById = watch('receivedById');
  useEffect(() => {
    if (!receivedById || !lookups) return;
    const holder = lookups.holders.find((h) => h.id === Number(receivedById));
    if (!holder) return;
    const byHolder = lookups.vatDefaults.byHolder;
    if (holder.name in byHolder) setValue('vatInvoice', byHolder[holder.name]);
  }, [receivedById, lookups, setValue]);

  const vatInvoice = watch('vatInvoice');

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      if (!unit) throw new Error(t('sell.noUnit'));
      return api.post<SellResponse>(`/units/${unit.id}/sell`, {
        soldCents: euroInputToCents(values.price),
        soldDate: values.soldDate,
        buyerCustomerId,
        buyerName: buyerCustomerId === null ? values.buyer.trim() || null : null,
        receivedById: Number(values.receivedById),
        paymentMethodId: values.paymentMethodId === '' ? null : Number(values.paymentMethodId),
        vatInvoice: values.vatInvoice,
      });
    },
    onSuccess: (data) => {
      const profit = data.saleProfitCents;
      const soldText = t('sell.soldOk', { code: data.unit.code });
      if (profit === null) {
        toast.success(soldText);
      } else {
        const isLoss = profit < 0;
        const message = (
          <span>
            {soldText} — {isLoss ? t('sell.loss') : t('sell.profit')}{' '}
            <span className={isLoss ? 'font-semibold text-loss' : 'font-semibold text-profit'}>
              {fmtEUR(profit, { sign: true })}
            </span>
          </span>
        );
        if (isLoss) toast.warning(message);
        else toast.success(message);
      }
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const holders = (lookups?.holders ?? []).filter((h) => h.active);
  const suggestions = customers.data?.customers ?? [];

  return (
    <Dialog open={open} onClose={onClose} title={t('sell.title', { code: unit?.code ?? '' })}>
      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        className="space-y-3"
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('sell.price')} error={errors.price?.message} required>
            <Input autoFocus inputMode="decimal" placeholder="350,00" {...register('price')} />
          </Field>
          <Field label={t('common:common.date')} error={errors.soldDate?.message} required>
            <Input type="date" {...register('soldDate')} />
          </Field>
        </div>
        <Field label={t('sell.buyer')} error={errors.buyer?.message} hint={t('sell.buyerHint')}>
          <Input
            placeholder={t('sell.buyerPlaceholder')}
            {...register('buyer', { onChange: () => setBuyerCustomerId(null) })}
          />
        </Field>
        {buyerCustomerId === null && suggestions.length > 0 ? (
          <div className="-mt-1 overflow-hidden rounded-md border">
            {suggestions.map((c) => (
              <button
                key={c.id}
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() => {
                  setBuyerCustomerId(c.id);
                  setValue('buyer', c.name);
                }}
              >
                {c.name}
              </button>
            ))}
          </div>
        ) : null}
        {buyerCustomerId !== null ? (
          <p className="-mt-1 text-2xs text-muted-foreground">{t('sell.linkedCustomer')}</p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common:money.receivedBy')} error={errors.receivedById?.message} required>
            <Select {...register('receivedById')}>
              <option value="">—</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:money.paymentMethod')} error={errors.paymentMethodId?.message}>
            <Select {...register('paymentMethodId')}>
              <option value="">—</option>
              {(lookups?.methods ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Checkbox label={t('common:money.vatInvoice')} {...register('vatInvoice')} />
        {!vatInvoice ? (
          <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
            {t('common:money.vatWarning')}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {t('sell.confirm')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
