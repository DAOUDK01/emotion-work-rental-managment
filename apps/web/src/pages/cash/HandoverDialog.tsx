import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, ApiError } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import {
  canHandOver,
  errorMessage,
  findCompanyHolder,
  type CreateHandoverBody,
  type CreateHandoverResponse,
  type HolderBalance,
} from './types';

interface HandoverForm {
  fromHolderId: string;
  toHolderId: string;
  date: string;
  amount: string;
  note: string;
}

interface OverdrawnState {
  body: CreateHandoverBody;
  holdingCents: number;
  fromName: string;
}

const FORM_ID = 'cash-handover-form';

/**
 * Hand over held money to another holder (normally the Company Account).
 * The API refuses amounts above the current holding with 409 OVERDRAWN; the user can
 * then read the explanation and deliberately "Record anyway" (force: true).
 */
export function HandoverDialog({
  open,
  onClose,
  balances,
  fromHolderId,
}: {
  open: boolean;
  onClose: () => void;
  balances: HolderBalance[];
  /** Pre-selected giving holder; when absent the first holder that can hand over is used. */
  fromHolderId: number | null;
}) {
  const { t } = useTranslation('cash');
  const queryClient = useQueryClient();
  const [overdrawn, setOverdrawn] = useState<OverdrawnState | null>(null);

  const holders = useMemo(() => balances.map((b) => b.holder), [balances]);
  const givers = useMemo(() => balances.filter((b) => canHandOver(b.holder.kind)), [balances]);
  const company = useMemo(() => findCompanyHolder(holders), [holders]);
  // The Company Account receives settlements; everyone else can be the giving side.
  const fromOptions = useMemo(() => balances.filter((b) => b.holder.kind !== 'COMPANY'), [balances]);

  const schema = useMemo(
    () =>
      z
        .object({
          fromHolderId: z.string().min(1, t('validation.fromRequired')),
          toHolderId: z.string().min(1, t('validation.toRequired')),
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.dateRequired')),
          amount: z.string().refine((v) => {
            const cents = euroInputToCents(v);
            return cents !== null && cents > 0;
          }, t('validation.amountPositive')),
          note: z.string().max(500, t('validation.noteTooLong')),
        })
        .refine((v) => v.fromHolderId !== v.toHolderId, {
          message: t('validation.sameHolder'),
          path: ['toHolderId'],
        }),
    [t],
  );

  const defaults = useMemo((): HandoverForm => {
    const from =
      balances.find((b) => b.holder.id === fromHolderId) ??
      givers.find((b) => b.holdingCents > 0) ??
      givers[0] ??
      null;
    const to = company ?? holders.find((h) => h.id !== from?.holder.id) ?? null;
    return {
      fromHolderId: from ? String(from.holder.id) : '',
      toHolderId: to ? String(to.id) : '',
      date: todayInHelsinki(),
      amount: from && from.holdingCents > 0 ? centsToInput(from.holdingCents) : '',
      note: '',
    };
  }, [balances, givers, holders, company, fromHolderId]);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<HandoverForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  // Fresh form each time the dialog opens (for the holder whose button was pressed).
  // Defaults are read through a ref so a background balances refetch never wipes what the user typed.
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  useEffect(() => {
    if (open) {
      reset(defaultsRef.current);
      setOverdrawn(null);
    }
  }, [open, fromHolderId, reset]);

  // Any edit after an OVERDRAWN warning invalidates the warning.
  useEffect(() => {
    const sub = watch(() => setOverdrawn(null));
    return () => sub.unsubscribe();
  }, [watch]);

  const selectedFromId = Number(watch('fromHolderId'));
  const selectedFrom = balances.find((b) => b.holder.id === selectedFromId);

  const mutation = useMutation({
    mutationFn: (body: CreateHandoverBody) => api.post<CreateHandoverResponse>('/cash/handovers', body),
    onSuccess: (res) => {
      toast.success(
        t('handover.success', {
          amount: fmtEUR(res.handover.amountCents),
          from: res.handover.fromHolder.name,
          to: res.handover.toHolder.name,
        }),
      );
      void queryClient.invalidateQueries({ queryKey: ['cash'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['partners'] });
      setOverdrawn(null);
      onClose();
    },
    onError: (err, body) => {
      if (err instanceof ApiError && err.code === 'OVERDRAWN' && !body.force) {
        const details = err.details as { holdingCents?: unknown } | undefined;
        const fromBalance = balances.find((b) => b.holder.id === body.fromHolderId);
        const holdingCents =
          typeof details?.holdingCents === 'number' ? details.holdingCents : (fromBalance?.holdingCents ?? 0);
        setOverdrawn({ body, holdingCents, fromName: fromBalance?.holder.name ?? '' });
        return;
      }
      toast.error(errorMessage(err, t('common:common.errorTitle')));
    },
  });

  const onSubmit = handleSubmit((values) => {
    const amountCents = euroInputToCents(values.amount);
    if (amountCents === null || amountCents <= 0) return;
    const note = values.note.trim();
    mutation.mutate({
      date: values.date,
      fromHolderId: Number(values.fromHolderId),
      toHolderId: Number(values.toHolderId),
      amountCents,
      ...(note ? { note } : {}),
    });
  });

  const close = () => {
    if (!mutation.isPending) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('handover.title')}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          {overdrawn ? (
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ ...overdrawn.body, force: true })}
            >
              {mutation.isPending ? t('handover.saving') : t('handover.recordAnyway')}
            </Button>
          ) : (
            <Button type="submit" form={FORM_ID} disabled={mutation.isPending}>
              {mutation.isPending ? t('handover.saving') : t('handover.submit')}
            </Button>
          )}
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
        <p className="text-xs text-muted-foreground">{t('handover.intro')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('handover.from')} error={errors.fromHolderId?.message} required>
            <Select
              {...register('fromHolderId', {
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                  const b = balances.find((x) => x.holder.id === Number(e.target.value));
                  setValue('amount', b && b.holdingCents > 0 ? centsToInput(b.holdingCents) : '');
                },
              })}
            >
              <option value="">{t('handover.choose')}</option>
              {fromOptions.map((b) => (
                <option key={b.holder.id} value={b.holder.id}>
                  {b.holder.name} — {fmtEUR(b.holdingCents)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('handover.to')} error={errors.toHolderId?.message} required>
            <Select {...register('toHolderId')}>
              <option value="">{t('handover.choose')}</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:common.date')} error={errors.date?.message} required>
            <Input type="date" max={todayInHelsinki()} {...register('date')} />
          </Field>
          <Field
            label={t('common:common.amount')}
            error={errors.amount?.message}
            required
            hint={selectedFrom ? t('handover.holdingHint', { amount: fmtEUR(selectedFrom.holdingCents) }) : undefined}
          >
            <Input inputMode="decimal" autoComplete="off" placeholder="0,00" {...register('amount')} />
          </Field>
          <Field
            label={`${t('handover.note')} (${t('common:common.optional')})`}
            error={errors.note?.message}
            className="sm:col-span-2"
          >
            <Textarea rows={2} maxLength={500} placeholder={t('handover.notePlaceholder')} {...register('note')} />
          </Field>
        </div>

        {overdrawn ? (
          <div
            role="alert"
            className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
          >
            <p className="flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {t('overdrawn.title')}
            </p>
            <p>
              {t('overdrawn.message', {
                name: overdrawn.fromName,
                holding: fmtEUR(overdrawn.holdingCents),
                amount: fmtEUR(overdrawn.body.amountCents),
                result: fmtEUR(overdrawn.holdingCents - overdrawn.body.amountCents),
              })}
            </p>
            <p>{t('overdrawn.advice')}</p>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
