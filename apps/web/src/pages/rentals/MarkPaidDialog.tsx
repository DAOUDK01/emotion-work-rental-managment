import { useEffect, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/input';
import { customerLabel, errorMessage, periodLabel, type Lookups, type RentalDetail, type RentalRow } from './types';

interface MarkPaidValues {
  receivedById: string;
  paymentMethodId: string;
}

/**
 * Mark a rental paid — the payment lives on the linked entry; the rentals API rewrites it:
 * PUT /rentals/:id { paymentStatus: 'PAID', receivedById, paymentMethodId }.
 * "Amount received by" is REQUIRED (no escape point for received money).
 */
export default function MarkPaidDialog({
  rental,
  lookups,
  onClose,
}: {
  rental: RentalRow | null;
  lookups: Lookups | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('rentals');
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        receivedById: z.string().min(1, t('form.validation.receivedByRequired')),
        paymentMethodId: z.string(),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MarkPaidValues>({
    resolver: zodResolver(schema),
    defaultValues: { receivedById: '', paymentMethodId: '' },
  });

  useEffect(() => {
    if (rental) {
      reset({
        receivedById: rental.receivedBy ? String(rental.receivedBy.id) : '',
        paymentMethodId: '',
      });
    }
  }, [rental, reset]);

  const markPaid = useMutation({
    mutationFn: (v: { id: number; receivedById: number; paymentMethodId: number | null }) =>
      api.put<{ rental: RentalDetail }>(`/rentals/${v.id}`, {
        paymentStatus: 'PAID',
        receivedById: v.receivedById,
        paymentMethodId: v.paymentMethodId,
      }),
    onSuccess: () => {
      toast.success(t('toasts.markedPaid'));
      void queryClient.invalidateQueries({ queryKey: ['rentals'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['cash'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onSubmit = handleSubmit((v) => {
    if (!rental) return;
    markPaid.mutate({
      id: rental.id,
      receivedById: Number(v.receivedById),
      paymentMethodId: v.paymentMethodId ? Number(v.paymentMethodId) : null,
    });
  });

  return (
    <Dialog
      open={rental !== null}
      onClose={markPaid.isPending ? () => undefined : onClose}
      title={t('markPaid.title')}
    >
      {rental ? (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-3 text-sm">
            <dt className="text-muted-foreground">{t('table.unit')}</dt>
            <dd className="font-medium">{rental.unit.code}</dd>
            <dt className="text-muted-foreground">{t('table.customer')}</dt>
            <dd>{customerLabel(rental)}</dd>
            <dt className="text-muted-foreground">{t('table.period')}</dt>
            <dd>{periodLabel(rental)}</dd>
            <dt className="text-muted-foreground">{t('table.amount')}</dt>
            <dd className="tabular-nums">{fmtEUR(rental.amountCents)}</dd>
          </dl>
          <Field label={t('common:money.receivedBy')} error={errors.receivedById?.message} required>
            <Select {...register('receivedById')} autoFocus>
              <option value="">{t('markPaid.selectReceiver')}</option>
              {(lookups?.holders ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:money.paymentMethod')}>
            <Select {...register('paymentMethodId')}>
              <option value="">{t('common:common.none')}</option>
              {(lookups?.methods ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-2xs text-muted-foreground">
            {t('markPaid.dateNote', { date: fmtDate(rental.startDate) })}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose} disabled={markPaid.isPending}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" disabled={markPaid.isPending}>
              {t('common:action.markPaid')}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
