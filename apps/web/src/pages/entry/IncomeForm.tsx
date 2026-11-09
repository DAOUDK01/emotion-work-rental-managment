import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { addVatToNet, bpToPct, incomeVat, todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { fmtEUR, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import { CustomerPicker, UnitPicker } from './Pickers';
import { IncomeSuccess } from './IncomeSuccess';
import { PreviewCard, type PreviewRow } from './PreviewCard';
import {
  PAYMENT_STATUSES,
  defaultRateBp,
  methodLabel,
  modelLabel,
  parseCents,
  parseRateBp,
  vatOptionsOn,
  vatRateLabel,
  type CustomerLite,
  type EntryListItem,
  type Lookups,
  type PaymentStatus,
  type UnitPayback,
} from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Unpaid statuses that can take a part-payment right away. */
const isOpen = (s: PaymentStatus) => s === 'PENDING' || s === 'INVOICED';

interface IncomeValues {
  entryDate: string;
  modelId: string;
  unitId: string;
  customerName: string;
  amount: string;
  enterNet: boolean;
  discount: string;
  discountReason: string;
  vatInvoice: boolean;
  vatRateBp: string;
  paymentStatus: PaymentStatus;
  paidNow: string;
  paymentMethodId: string;
  receivedById: string;
  notes: string;
}

interface CreateEntryPayload {
  entryDate: string;
  modelId: number;
  unitId: number | null;
  customerId: number | null;
  customerName: string | null;
  description: string | null;
  grossBeforeDiscountCents: number;
  discountCents: number;
  discountReason: string | null;
  vatInvoice: boolean;
  vatRateBp: number;
  paymentStatus: PaymentStatus;
  paidNowCents: number | null;
  paymentMethodId: number | null;
  receivedById: number | null;
}

interface CreateEntryResponse {
  entry: EntryListItem;
  unitPayback?: UnitPayback | null;
}

interface IncomeCalc {
  netMode: boolean;
  typedCents: number;
  grossBeforeCents: number;
  discountCents: number;
  rateBp: number;
  grossCents: number;
  vatCents: number;
  netCents: number;
  nonVatCents: number;
}

/** Client-side mirror of the API's VAT maths (shared incomeVat / addVatToNet). */
function computeIncome(
  v: Pick<IncomeValues, 'amount' | 'enterNet' | 'discount' | 'vatInvoice' | 'vatRateBp'>,
): IncomeCalc | null {
  const typedCents = parseCents(v.amount);
  const rateBp = parseRateBp(v.vatRateBp);
  if (typedCents === null || rateBp === null) return null;
  const netMode = v.enterNet && v.vatInvoice;
  const grossBeforeCents = netMode ? addVatToNet(typedCents, rateBp).grossCents : typedCents;
  const discountCents = Math.min(parseCents(v.discount) ?? 0, grossBeforeCents);
  const split = incomeVat(grossBeforeCents - discountCents, rateBp, v.vatInvoice);
  return {
    netMode,
    typedCents,
    grossBeforeCents,
    discountCents,
    rateBp,
    grossCents: split.grossCents,
    vatCents: split.vatCents,
    netCents: split.netCents,
    nonVatCents: split.nonVatCents,
  };
}

function emptyIncome(entryDate: string, modelId: string, rateBp: number): IncomeValues {
  return {
    entryDate,
    modelId,
    unitId: '',
    customerName: '',
    amount: '',
    enterNet: false,
    discount: '',
    discountReason: '',
    vatInvoice: false,
    vatRateBp: String(rateBp),
    paymentStatus: 'PAID',
    paidNow: '',
    paymentMethodId: '',
    receivedById: '',
    notes: '',
  };
}

/** INCOME tab — POST /entries with a live VAT preview and the unit payback after saving. */
export function IncomeForm({ lookups }: { lookups: Lookups }) {
  const { t, i18n } = useTranslation('entry');
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const rateTouched = useRef(false);
  const [linkedCustomer, setLinkedCustomer] = useState<CustomerLite | null>(null);
  const [saved, setSaved] = useState<CreateEntryResponse | null>(null);

  const schema = useMemo(
    () =>
      z
        .object({
          entryDate: z.string().regex(ISO_DATE_RE, t('validation.dateRequired')),
          modelId: z.string().min(1, t('validation.typeRequired')),
          unitId: z.string(),
          customerName: z.string().max(200, t('validation.tooLong')),
          amount: z.string(),
          enterNet: z.boolean(),
          discount: z.string(),
          discountReason: z.string().max(200, t('validation.tooLong')),
          vatInvoice: z.boolean(),
          vatRateBp: z.string().min(1, t('validation.rateRequired')),
          paymentStatus: z.enum(PAYMENT_STATUSES),
          paidNow: z.string(),
          paymentMethodId: z.string(),
          receivedById: z.string(),
          notes: z.string().max(2000, t('validation.tooLong')),
        })
        .superRefine((v, ctx) => {
          const typed = parseCents(v.amount);
          if (typed === null || typed === 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['amount'],
              message: t('validation.amountInvalid'),
            });
          }
          const discount = v.discount.trim() ? parseCents(v.discount) : 0;
          if (discount === null) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['discount'],
              message: t('validation.amountInvalid'),
            });
          } else if (discount > 0) {
            const calc = computeIncome(v);
            if (calc && discount > calc.grossBeforeCents) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['discount'],
                message: t('validation.discountTooHigh'),
              });
            }
          }
          if (v.paymentStatus === 'PAID' && !v.receivedById) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['receivedById'],
              message: t('validation.receivedByRequired'),
            });
          }
          // part-payment now (only for unpaid statuses): 0 … total, needs "Amount received by"
          if (isOpen(v.paymentStatus) && v.paidNow.trim()) {
            const paidNow = parseCents(v.paidNow);
            const calc = computeIncome(v);
            if (paidNow === null) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['paidNow'],
                message: t('validation.paidNowInvalid'),
              });
            } else if (calc && paidNow > calc.grossCents) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['paidNow'],
                message: t('validation.paidNowTooHigh'),
              });
            } else if (paidNow > 0 && !v.receivedById) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['receivedById'],
                message: t('validation.receivedByForPaidNow'),
              });
            }
          }
        }),
    [t],
  );

  const today = todayInHelsinki();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    control,
    formState: { errors },
  } = useForm<IncomeValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyIncome(today, '', defaultRateBp(lookups.vatRates, today)),
  });

  // ---- VAT rate follows the entry date (default series) until the user picks one by hand
  const entryDate = watch('entryDate');
  useEffect(() => {
    if (rateTouched.current || !ISO_DATE_RE.test(entryDate)) return;
    setValue('vatRateBp', String(defaultRateBp(lookups.vatRates, entryDate)));
  }, [entryDate, lookups.vatRates, setValue]);

  // ---- "VAT invoice issued?" default: by receiver (settings vatDefaults.byHolder), then payment method
  const applyVatDefault = (receiverId: string, methodId: string) => {
    const holder = lookups.holders.find((h) => String(h.id) === receiverId);
    if (holder && holder.name in lookups.vatDefaults.byHolder) {
      setValue('vatInvoice', lookups.vatDefaults.byHolder[holder.name]);
      return;
    }
    const method = lookups.methods.find((m) => String(m.id) === methodId);
    if (method) setValue('vatInvoice', method.defaultVatInvoice);
  };

  const values = watch();
  const calc = computeIncome(values);
  const selectedRateBp = parseRateBp(values.vatRateBp) ?? undefined;
  const rateOptions = vatOptionsOn(lookups.vatRates, values.entryDate, selectedRateBp);
  const pctOf = (bp: number) => fmtPct(bpToPct(bp), bp % 100 === 0 ? 0 : 1);
  const amountLabel =
    values.enterNet && values.vatInvoice ? t('income.amountNet') : t('income.amountGross');
  const showPaidNow = isOpen(values.paymentStatus);
  const paidNowCents = showPaidNow ? (parseCents(values.paidNow) ?? 0) : 0;
  const receivedByNeeded = values.paymentStatus === 'PAID' || paidNowCents > 0;

  const save = useMutation({
    mutationFn: (payload: CreateEntryPayload) => api.post<CreateEntryResponse>('/entries', payload),
    onSuccess: (res, payload) => {
      toast.success(t('common:common.savedOk'));
      setSaved(res);
      void queryClient.invalidateQueries({ queryKey: ['entries'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['cash'] });
      if (payload.unitId !== null) void queryClient.invalidateQueries({ queryKey: ['units'] });
      // reset the form, keeping date + type for the next entry
      rateTouched.current = false;
      setLinkedCustomer(null);
      reset(
        emptyIncome(
          payload.entryDate,
          String(payload.modelId),
          defaultRateBp(lookups.vatRates, payload.entryDate),
        ),
      );
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t('common:common.errorTitle')),
  });

  const onSubmit = handleSubmit((v) => {
    const c = computeIncome(v);
    if (!c) return;
    save.mutate({
      entryDate: v.entryDate,
      modelId: Number(v.modelId),
      unitId: v.unitId ? Number(v.unitId) : null,
      customerId: linkedCustomer?.id ?? null,
      customerName: linkedCustomer ? null : v.customerName.trim() || null,
      description: v.notes.trim() || null,
      grossBeforeDiscountCents: c.grossBeforeCents,
      discountCents: c.discountCents,
      discountReason: c.discountCents > 0 ? v.discountReason.trim() || null : null,
      vatInvoice: v.vatInvoice,
      vatRateBp: c.rateBp,
      paymentStatus: v.paymentStatus,
      paidNowCents: isOpen(v.paymentStatus) && v.paidNow.trim() ? parseCents(v.paidNow) : null,
      paymentMethodId: v.paymentMethodId ? Number(v.paymentMethodId) : null,
      receivedById: v.receivedById ? Number(v.receivedById) : null,
    });
  });

  const previewRows: PreviewRow[] | null = calc
    ? [
        ...(calc.netMode
          ? [
              {
                key: 'typedNet',
                label: t('preview.netEntered'),
                value: fmtEUR(calc.typedCents),
                muted: true,
              },
              {
                key: 'grossBefore',
                label: t('preview.grossBeforeDiscount'),
                value: fmtEUR(calc.grossBeforeCents),
                muted: true,
              },
            ]
          : calc.discountCents > 0
            ? [
                {
                  key: 'grossBefore',
                  label: t('preview.grossBeforeDiscount'),
                  value: fmtEUR(calc.grossBeforeCents),
                  muted: true,
                },
              ]
            : []),
        {
          key: 'gross',
          label: t('common:money.gross'),
          value: fmtEUR(calc.grossCents),
          strong: true,
        },
        {
          key: 'discount',
          label: t('preview.discount'),
          value: calc.discountCents > 0 ? fmtEUR(-calc.discountCents) : fmtEUR(0),
          tone: calc.discountCents > 0 ? 'loss' : undefined,
        },
        {
          key: 'vat',
          label: `${t('common:money.vat')} (${values.vatInvoice ? pctOf(calc.rateBp) : t('preview.noVatInvoice')})`,
          value: fmtEUR(calc.vatCents),
        },
        { key: 'net', label: t('common:money.net'), value: fmtEUR(calc.netCents), strong: true },
        { key: 'nonVat', label: t('common:money.nonVat'), value: fmtEUR(calc.nonVatCents) },
        ...(showPaidNow
          ? [
              {
                key: 'paidNow',
                label: t('preview.paidNow'),
                value: fmtEUR(Math.min(paidNowCents, calc.grossCents)),
              },
              {
                key: 'owed',
                label: t('preview.stillOwed'),
                value: fmtEUR(Math.max(0, calc.grossCents - paidNowCents)),
                strong: true,
                tone: calc.grossCents - paidNowCents > 0 ? ('loss' as const) : undefined,
              },
            ]
          : []),
      ]
    : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {saved ? (
          <IncomeSuccess
            entry={saved.entry}
            unitPayback={saved.unitPayback ?? null}
            onClose={() => setSaved(null)}
          />
        ) : null}

        <Card>
          <CardContent className="pt-4">
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('common:common.date')} error={errors.entryDate?.message} required>
                  <Input
                    type="date"
                    aria-label={t('common:common.date')}
                    {...register('entryDate')}
                  />
                </Field>
                <Field label={t('income.type')} error={errors.modelId?.message} required>
                  <Select aria-label={t('income.type')} {...register('modelId')}>
                    <option value="">{t('income.selectType')}</option>
                    {lookups.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {modelLabel(m, lang)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('fields.unit')} hint={t('income.unitHint')}>
                  <UnitPicker
                    label={t('fields.unit')}
                    value={values.unitId ? Number(values.unitId) : null}
                    onChange={(id) => setValue('unitId', id === null ? '' : String(id))}
                  />
                </Field>
                <Field
                  label={t('income.customer')}
                  error={errors.customerName?.message}
                  hint={linkedCustomer ? t('income.customerLinkedHint') : t('income.customerHint')}
                >
                  <CustomerPicker
                    label={t('income.customer')}
                    name={values.customerName}
                    onNameChange={(name) =>
                      setValue('customerName', name, {
                        shouldValidate: Boolean(errors.customerName),
                      })
                    }
                    linked={linkedCustomer}
                    onLinkedChange={setLinkedCustomer}
                  />
                </Field>

                <Field
                  label={amountLabel}
                  error={errors.amount?.message}
                  required
                  hint={
                    values.enterNet && !values.vatInvoice
                      ? t('income.netNeedsVatInvoice')
                      : undefined
                  }
                >
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label={amountLabel}
                    {...register('amount')}
                  />
                  <Controller
                    control={control}
                    name="enterNet"
                    render={({ field }) => (
                      <Checkbox
                        label={t('income.enterNet')}
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                </Field>
                <Field
                  label={t('common:money.vatRate')}
                  error={errors.vatRateBp?.message}
                  required
                  hint={values.vatInvoice ? undefined : t('income.rateUnusedHint')}
                >
                  <Select
                    aria-label={t('common:money.vatRate')}
                    {...register('vatRateBp', { onChange: () => (rateTouched.current = true) })}
                  >
                    {rateOptions.map((r) => (
                      <option key={r.id} value={r.rateBp}>
                        {vatRateLabel(r)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('common:money.discount')} error={errors.discount?.message}>
                  <Input
                    inputMode="decimal"
                    placeholder="0,00"
                    aria-label={t('common:money.discount')}
                    {...register('discount')}
                  />
                </Field>
                <Field
                  label={t('common:money.discountReason')}
                  error={errors.discountReason?.message}
                >
                  <Input
                    aria-label={t('common:money.discountReason')}
                    placeholder={t('income.discountReasonPlaceholder')}
                    {...register('discountReason')}
                  />
                </Field>

                <div className="space-y-1.5 sm:col-span-2">
                  <Controller
                    control={control}
                    name="vatInvoice"
                    render={({ field }) => (
                      <Checkbox
                        label={t('common:money.vatInvoice')}
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                  <p className="text-2xs text-muted-foreground">{t('income.vatDefaultHint')}</p>
                  {!values.vatInvoice ? (
                    <p
                      className="flex items-start gap-1.5 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300"
                      role="note"
                    >
                      <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                      {t('common:money.vatWarning')}
                    </p>
                  ) : null}
                </div>

                <Field
                  label={t('fields.paymentStatus')}
                  error={errors.paymentStatus?.message}
                  required
                >
                  <Select aria-label={t('fields.paymentStatus')} {...register('paymentStatus')}>
                    {PAYMENT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`common:status.${s}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                {showPaidNow ? (
                  <Field
                    label={t('income.paidNow')}
                    error={errors.paidNow?.message}
                    hint={t('income.paidNowHint')}
                  >
                    <Input
                      inputMode="decimal"
                      placeholder="0,00"
                      aria-label={t('income.paidNow')}
                      {...register('paidNow')}
                    />
                  </Field>
                ) : null}
                <Field label={t('common:money.paymentMethod')}>
                  <Select
                    aria-label={t('common:money.paymentMethod')}
                    {...register('paymentMethodId', {
                      onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                        applyVatDefault(getValues('receivedById'), e.target.value),
                    })}
                  >
                    <option value="">{t('fields.notSet')}</option>
                    {lookups.methods.map((m) => (
                      <option key={m.id} value={m.id}>
                        {methodLabel(m, lang)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label={t('common:money.receivedBy')}
                  error={errors.receivedById?.message}
                  required={receivedByNeeded}
                  hint={receivedByNeeded ? undefined : t('income.receivedByHint')}
                >
                  <Select
                    aria-label={t('common:money.receivedBy')}
                    {...register('receivedById', {
                      onChange: (e: React.ChangeEvent<HTMLSelectElement>) =>
                        applyVatDefault(e.target.value, getValues('paymentMethodId')),
                    })}
                  >
                    <option value="">{t('fields.notSet')}</option>
                    {lookups.holders.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label={t('common:common.notes')}
                  error={errors.notes?.message}
                  className="sm:col-span-2"
                >
                  <Textarea
                    rows={2}
                    aria-label={t('common:common.notes')}
                    placeholder={t('income.notesPlaceholder')}
                    {...register('notes')}
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => {
                    rateTouched.current = false;
                    setLinkedCustomer(null);
                    reset(
                      emptyIncome(
                        getValues('entryDate'),
                        getValues('modelId'),
                        defaultRateBp(lookups.vatRates, getValues('entryDate')),
                      ),
                    );
                  }}
                  disabled={save.isPending}
                >
                  {t('actions.clear')}
                </Button>
                <Button type="submit" size="lg" disabled={save.isPending} className="min-w-40">
                  {save.isPending ? t('actions.saving') : t('income.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <PreviewCard
        title={t('preview.title')}
        description={calc?.netMode ? t('preview.netModeHint') : t('preview.hint')}
        rows={previewRows}
        emptyText={t('preview.empty')}
      />
    </div>
  );
}
