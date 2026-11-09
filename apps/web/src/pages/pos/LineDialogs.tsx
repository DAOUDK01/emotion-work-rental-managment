import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { centsToInput, euroInputToCents, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Segmented } from '@/components/ui/misc';
import {
  currentVatRateBp,
  discountLimitPct,
  errMsg,
  fmtVatRate,
  parseQty,
  vatRateOptions,
  type Lookups,
} from './types';

function parsePct(value: string): number | null {
  const n = Number(value.trim().replace(',', '.').replace('%', ''));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

// ---------------------------------------------------------------- discount (line or cart)

export interface DiscountBody {
  cents?: number;
  pct?: number;
  reason: string | null;
}

interface DiscountForm {
  mode: 'eur' | 'pct';
  value: string;
  reason: string;
}

/** € or % discount + reason — used for a single line and for the whole cart. */
export function DiscountDialog({
  open,
  title,
  description,
  baseCents,
  initialCents,
  initialReason,
  maxDiscountPct,
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description: string;
  /** Amount the discount applies to (for the % preview and the € upper bound). */
  baseCents: number;
  initialCents: number;
  initialReason: string | null;
  maxDiscountPct: number;
  onClose: () => void;
  onSubmit: (body: DiscountBody) => Promise<unknown>;
}) {
  const { t } = useTranslation('pos');
  const [limitError, setLimitError] = useState<string | null>(null);

  const schema = useMemo(
    () =>
      z
        .object({ mode: z.enum(['eur', 'pct']), value: z.string().trim(), reason: z.string().trim().max(200) })
        .superRefine((v, ctx) => {
          if (v.value === '') {
            ctx.addIssue({ code: 'custom', path: ['value'], message: t('validation.amountRequired') });
            return;
          }
          if (v.mode === 'eur') {
            const c = euroInputToCents(v.value);
            if (c === null || c < 0) ctx.addIssue({ code: 'custom', path: ['value'], message: t('validation.badAmount') });
            else if (c > baseCents)
              ctx.addIssue({ code: 'custom', path: ['value'], message: t('discount.tooBig', { max: fmtEUR(baseCents) }) });
            else if (c > 0 && v.reason === '')
              ctx.addIssue({ code: 'custom', path: ['reason'], message: t('validation.reasonRequired') });
          } else {
            const p = parsePct(v.value);
            if (p === null) ctx.addIssue({ code: 'custom', path: ['value'], message: t('validation.badPct') });
            else if (p > 0 && v.reason === '')
              ctx.addIssue({ code: 'custom', path: ['reason'], message: t('validation.reasonRequired') });
          }
        }),
    [t, baseCents],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<DiscountForm>({
    resolver: zodResolver(schema),
    defaultValues: { mode: 'eur', value: '', reason: '' },
  });

  useEffect(() => {
    if (!open) return;
    setLimitError(null);
    reset({ mode: 'eur', value: initialCents > 0 ? centsToInput(initialCents) : '', reason: initialReason ?? '' });
  }, [open, initialCents, initialReason, reset]);

  const mode = watch('mode');
  const value = watch('value');
  const previewCents =
    mode === 'eur'
      ? euroInputToCents(value) ?? 0
      : Math.round((baseCents * (parsePct(value) ?? 0)) / 100);

  const save = useMutation({
    mutationFn: onSubmit,
    onSuccess: () => {
      toast.success(t('common:common.savedOk'));
      onClose();
    },
    onError: (err) => {
      const pct = discountLimitPct(err, maxDiscountPct);
      if (pct !== null) {
        const msg = t('discount.limit', { pct });
        setLimitError(msg);
        toast.error(msg);
      } else {
        toast.error(errMsg(err));
      }
    },
  });

  const submit = handleSubmit((v) => {
    setLimitError(null);
    const reason = v.reason.trim() || null;
    if (v.mode === 'eur') save.mutate({ cents: euroInputToCents(v.value) ?? 0, reason });
    else save.mutate({ pct: parsePct(v.value) ?? 0, reason });
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          {initialCents > 0 ? (
            <Button
              variant="ghost"
              className="mr-auto text-destructive"
              disabled={save.isPending}
              onClick={() => save.mutate({ cents: 0, reason: null })}
            >
              {t('discount.remove')}
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form="pos-discount-form" disabled={save.isPending}>
            {t('discount.apply')}
          </Button>
        </>
      }
    >
      <form id="pos-discount-form" onSubmit={submit} className="space-y-3" noValidate>
        <p className="text-xs text-muted-foreground">{description}</p>
        <Segmented
          value={mode}
          onChange={(m) => setValue('mode', m)}
          options={[
            { value: 'eur' as const, label: t('discount.modeEur') },
            { value: 'pct' as const, label: t('discount.modePct') },
          ]}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={mode === 'eur' ? t('common:money.discount') : t('discount.percent')}
            error={errors.value?.message}
            required
          >
            <Input inputMode="decimal" autoFocus placeholder={mode === 'eur' ? '0,00' : '10'} {...register('value')} />
          </Field>
          <div className="flex flex-col justify-end pb-1 text-sm">
            <span className="text-xs text-muted-foreground">{t('discount.preview')}</span>
            <span className="font-semibold tabular-nums">−{fmtEUR(Math.min(previewCents, baseCents))}</span>
          </div>
        </div>
        <Field label={t('common:money.discountReason')} error={errors.reason?.message} required>
          <Input {...register('reason')} />
        </Field>
        <p className="text-2xs text-muted-foreground">{t('discount.yourLimit', { pct: maxDiscountPct })}</p>
        {limitError ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive" role="alert">
            {limitError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------- labour / free-text line

export interface CustomLineBody {
  description: string;
  qty: number;
  unitPriceCents: number;
  vatRateBp: number;
  isLabour: boolean;
}

interface CustomLineForm {
  description: string;
  mode: 'amount' | 'hours';
  amount: string;
  hours: string;
  rate: string;
  qty: string;
  vatRateBp: string;
}

/** "+ Labour" (amount, or hours × rate) and free-text lines. */
export function CustomLineDialog({
  kind,
  lookups,
  exclVat,
  onClose,
  onSubmit,
}: {
  kind: 'labour' | 'free' | null;
  lookups: Lookups | undefined;
  /** true = the typed price is without VAT; VAT is added on top in the cart. */
  exclVat: boolean;
  onClose: () => void;
  onSubmit: (body: CustomLineBody) => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation('pos');
  const open = kind !== null;

  const schema = useMemo(
    () =>
      z
        .object({
          description: z.string().trim().min(1, t('validation.descriptionRequired')).max(300),
          mode: z.enum(['amount', 'hours']),
          amount: z.string(),
          hours: z.string(),
          rate: z.string(),
          qty: z.string(),
          vatRateBp: z.string().min(1),
        })
        .superRefine((v, ctx) => {
          const money = (field: 'amount' | 'rate', value: string) => {
            const c = euroInputToCents(value);
            if (value.trim() === '') ctx.addIssue({ code: 'custom', path: [field], message: t('validation.amountRequired') });
            else if (c === null || c < 0) ctx.addIssue({ code: 'custom', path: [field], message: t('validation.badAmount') });
          };
          if (kind === 'labour' && v.mode === 'hours') {
            if (parseQty(v.hours) === null) ctx.addIssue({ code: 'custom', path: ['hours'], message: t('validation.badQty') });
            money('rate', v.rate);
          } else {
            money('amount', v.amount);
          }
          if (kind === 'free' && parseQty(v.qty) === null)
            ctx.addIssue({ code: 'custom', path: ['qty'], message: t('validation.badQty') });
        }),
    [t, kind],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CustomLineForm>({
    resolver: zodResolver(schema),
    defaultValues: { description: '', mode: 'amount', amount: '', hours: '', rate: '', qty: '1', vatRateBp: '2550' },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      description: kind === 'labour' ? t('labour.defaultDescription') : '',
      mode: 'amount',
      amount: '',
      hours: '',
      rate: '',
      qty: '1',
      vatRateBp: String(currentVatRateBp(lookups)),
    });
  }, [open, kind, lookups, reset, t]);

  const mode = watch('mode');
  const hours = watch('hours');
  const rate = watch('rate');
  const amount = watch('amount');
  const qty = watch('qty');
  const hoursTotalCents = Math.round((parseQty(hours) ?? 0) * (euroInputToCents(rate) ?? 0));
  const freeTotalCents = Math.round((parseQty(qty) ?? 0) * (euroInputToCents(amount) ?? 0));

  const save = useMutation({
    mutationFn: onSubmit,
    onSuccess: () => {
      toast.success(t('labour.added'));
      onClose();
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  const submit = handleSubmit((v) => {
    const vatRateBp = Number(v.vatRateBp);
    if (kind === 'labour') {
      const unitPriceCents = v.mode === 'hours' ? hoursTotalCents : euroInputToCents(v.amount) ?? 0;
      save.mutate({ description: v.description.trim(), qty: 1, unitPriceCents, vatRateBp, isLabour: true });
    } else {
      save.mutate({
        description: v.description.trim(),
        qty: parseQty(v.qty) ?? 1,
        unitPriceCents: euroInputToCents(v.amount) ?? 0,
        vatRateBp,
        isLabour: false,
      });
    }
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={kind === 'labour' ? t('labour.title') : t('freeLine.title')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form="pos-custom-line" disabled={save.isPending}>
            {t('labour.addToCart')}
          </Button>
        </>
      }
    >
      <form id="pos-custom-line" onSubmit={submit} className="space-y-3" noValidate>
        <Field label={t('labour.description')} error={errors.description?.message} required>
          <Input autoFocus {...register('description')} />
        </Field>

        {kind === 'labour' ? (
          <Segmented
            value={mode}
            onChange={(m) => setValue('mode', m)}
            options={[
              { value: 'amount' as const, label: t('labour.modeAmount') },
              { value: 'hours' as const, label: t('labour.modeHours') },
            ]}
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          {kind === 'labour' && mode === 'hours' ? (
            <>
              <Field label={t('labour.hours')} error={errors.hours?.message} required>
                <Input inputMode="decimal" placeholder="1,5" {...register('hours')} />
              </Field>
              <Field label={exclVat ? t('labour.rateExclVat') : t('labour.rate')} error={errors.rate?.message} required>
                <Input inputMode="decimal" placeholder="0,00" {...register('rate')} />
              </Field>
              <p className="text-sm sm:col-span-2">
                {t('labour.computed')}: <span className="font-semibold tabular-nums">{fmtEUR(hoursTotalCents)}</span>
              </p>
            </>
          ) : (
            <>
              {kind === 'free' ? (
                <Field label={t('freeLine.qty')} error={errors.qty?.message} required>
                  <Input inputMode="decimal" {...register('qty')} />
                </Field>
              ) : null}
              <Field
                label={
                  kind === 'free'
                    ? exclVat
                      ? t('freeLine.unitPriceExclVat')
                      : t('freeLine.unitPrice')
                    : exclVat
                      ? t('labour.amountExclVat')
                      : t('common:money.gross')
                }
                error={errors.amount?.message}
                required
              >
                <Input inputMode="decimal" placeholder="0,00" {...register('amount')} />
              </Field>
              {kind === 'free' ? (
                <p className="text-sm sm:col-span-2">
                  {t('common:common.total')}: <span className="font-semibold tabular-nums">{fmtEUR(freeTotalCents)}</span>
                </p>
              ) : null}
            </>
          )}
          <Field label={t('common:money.vatRate')} error={errors.vatRateBp?.message} required>
            <Select {...register('vatRateBp')}>
              {vatRateOptions(lookups).map((bp) => (
                <option key={bp} value={bp}>
                  {fmtVatRate(bp, i18n.language)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
