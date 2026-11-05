import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { bpToPct, reclaimableVat, roundHalfAwayFromZero, splitGross, todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { centsToInput, fmtEUR, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import { DuplicateWarningDialog } from './DuplicateWarningDialog';
import { ProductSelect, UnitSelect } from './Pickers';
import { ReceiptUploader } from './ReceiptUploader';
import {
  ISO_DATE_RE,
  categoryLabel,
  defaultRateBp,
  errorMessage,
  parseCents,
  parsePct,
  parseQty,
  parseRateBp,
  vatOptionsOn,
  vatRateLabel,
  type CreateExpenseResponse,
  type ExpenseDuplicate,
  type ExpensePayload,
  type ExpenseRow,
  type Lookups,
  type ProductLite,
} from './types';

interface FormValues {
  expenseDate: string;
  categoryId: string;
  description: string;
  vendor: string;
  qtyText: string;
  amount: string;
  vatRateBp: string;
  hasValidReceipt: boolean;
  businessUsePct: string;
  paidById: string;
  jointReinvested: boolean;
  unitId: string;
  productId: string;
  stockQty: string;
  purchasedFor: string;
  notes: string;
}

interface SavedInfo {
  id: number;
  description: string;
  grossCents: number | null;
  reclaimableVatCents: number;
}

type Step =
  | { kind: 'form' }
  | { kind: 'duplicates'; saved: SavedInfo; duplicates: ExpenseDuplicate[] }
  | { kind: 'receipt'; saved: SavedInfo };

function blankValues(lookups: Lookups, date: string, paidById = ''): FormValues {
  return {
    expenseDate: date,
    categoryId: '',
    description: '',
    vendor: '',
    qtyText: '',
    amount: '',
    vatRateBp: String(defaultRateBp(lookups.vatRates, date)),
    hasValidReceipt: false,
    businessUsePct: '100',
    paidById,
    jointReinvested: false,
    unitId: '',
    productId: '',
    stockQty: '',
    purchasedFor: '',
    notes: '',
  };
}

function valuesFrom(e: ExpenseRow): FormValues {
  return {
    expenseDate: e.expenseDate ?? '',
    categoryId: String(e.categoryId),
    description: e.description,
    vendor: e.vendor ?? '',
    qtyText: e.qtyText ?? '',
    amount: centsToInput(e.grossCents),
    vatRateBp: String(e.vatRateBp),
    hasValidReceipt: e.hasValidReceipt,
    businessUsePct: String(e.businessUsePct),
    paidById: e.paidById ? String(e.paidById) : '',
    jointReinvested: e.jointReinvested,
    unitId: e.unitId ? String(e.unitId) : '',
    productId: e.productId ? String(e.productId) : '',
    stockQty: '',
    purchasedFor: e.purchasedFor ?? '',
    notes: e.notes ?? '',
  };
}

/**
 * Create / edit an expense (POST /expenses, PUT /expenses/:id) — the full form incl. the stock
 * link (product + quantity → PURCHASE movement), a live reclaimable-VAT preview, the duplicate
 * warning after create, and the receipt upload once the expense exists.
 */
export function ExpenseFormDialog({
  expense,
  lookups,
  onClose,
}: {
  expense: ExpenseRow | null;
  lookups: Lookups;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('expenses');
  const lang = i18n.language;
  const formId = useId();
  const queryClient = useQueryClient();
  const isEdit = expense !== null;
  const rateTouched = useRef(isEdit);
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [product, setProduct] = useState<ProductLite | null>(
    expense?.product
      ? { id: expense.product.id, sku: expense.product.sku, nameEn: expense.product.nameEn, nameFi: null, trackStock: true, stockQty: null }
      : null,
  );

  const categories = useMemo(() => {
    const list = [...lookups.expenseCategories];
    const current = expense?.category;
    if (current && !list.some((c) => c.id === current.id)) list.push(current);
    return list;
  }, [lookups.expenseCategories, expense]);
  const holders = useMemo(() => {
    const list: Array<{ id: number; name: string }> = [...lookups.holders];
    const payer = expense?.paidBy;
    if (payer && !list.some((h) => h.id === payer.id)) list.push(payer);
    return list;
  }, [lookups.holders, expense]);

  const schema = useMemo(
    () =>
      z
        .object({
          expenseDate: z.string(),
          categoryId: z.string().min(1, t('validation.categoryRequired')),
          description: z.string().trim().min(1, t('validation.descriptionRequired')).max(500, t('validation.tooLong')),
          vendor: z.string().max(200, t('validation.tooLong')),
          qtyText: z.string().max(100, t('validation.tooLong')),
          amount: z.string(),
          vatRateBp: z.string().min(1, t('validation.rateRequired')),
          hasValidReceipt: z.boolean(),
          businessUsePct: z.string(),
          paidById: z.string(),
          jointReinvested: z.boolean(),
          unitId: z.string(),
          productId: z.string(),
          stockQty: z.string(),
          purchasedFor: z.string().max(200, t('validation.tooLong')),
          notes: z.string().max(2000, t('validation.tooLong')),
        })
        .superRefine((v, ctx) => {
          const dateEmpty = v.expenseDate.trim() === '';
          if ((!isEdit && dateEmpty) || (!dateEmpty && !ISO_DATE_RE.test(v.expenseDate))) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expenseDate'], message: t('validation.dateRequired') });
          }
          const amountEmpty = v.amount.trim() === '';
          const amount = parseCents(v.amount);
          if ((!isEdit && (amount === null || amount === 0)) || (!amountEmpty && amount === null)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: t('validation.amountInvalid') });
          }
          if (parsePct(v.businessUsePct) === null) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['businessUsePct'], message: t('validation.pctInvalid') });
          }
          if (v.stockQty.trim() !== '') {
            if (parseQty(v.stockQty) === null) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stockQty'], message: t('validation.qtyInvalid') });
            } else if (!v.productId) {
              ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['productId'], message: t('validation.productRequired') });
            }
          }
        }),
    [t, isEdit],
  );

  const today = todayInHelsinki();
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    getValues,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: expense ? valuesFrom(expense) : blankValues(lookups, today),
  });

  const expenseDate = watch('expenseDate');
  useEffect(() => {
    if (rateTouched.current || !ISO_DATE_RE.test(expenseDate)) return;
    setValue('vatRateBp', String(defaultRateBp(lookups.vatRates, expenseDate)));
  }, [expenseDate, lookups.vatRates, setValue]);

  const values = watch();
  const grossCents = parseCents(values.amount);
  const rateBp = parseRateBp(values.vatRateBp);
  const usePct = parsePct(values.businessUsePct);
  const stockQty = parseQty(values.stockQty);
  const rateOptions = vatOptionsOn(lookups.vatRates, values.expenseDate, rateBp ?? undefined);
  const selectedPaidBy = lookups.holders.find((h) => String(h.id) === values.paidById);

  const preview =
    grossCents !== null && rateBp !== null && usePct !== null
      ? {
          vatInPrice: splitGross(grossCents, rateBp).vatCents,
          reclaim: reclaimableVat({ grossCents, rateBp, hasValidReceipt: values.hasValidReceipt, businessUsePct: usePct }),
        }
      : null;

  const invalidateAll = (withUnits: boolean, withStock: boolean) => {
    for (const key of ['expenses', 'dashboard', 'vat', 'investments', 'partners']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    if (withUnits) void queryClient.invalidateQueries({ queryKey: ['units'] });
    if (withStock) {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    }
  };

  const save = useMutation({
    mutationFn: async (payload: ExpensePayload): Promise<CreateExpenseResponse> => {
      if (!expense) return api.post<CreateExpenseResponse>('/expenses', payload);
      const res = await api.put<{ expense: ExpenseRow }>(`/expenses/${expense.id}`, payload);
      return { expense: res.expense, duplicates: [] };
    },
    onSuccess: (res, payload) => {
      toast.success(t('common:common.savedOk'));
      invalidateAll(payload.unitId !== null || expense?.unitId != null, payload.productId !== null || expense?.productId != null);
      if (isEdit) {
        onClose();
        return;
      }
      const saved: SavedInfo = {
        id: res.expense.id,
        description: res.expense.description,
        grossCents: res.expense.grossCents,
        reclaimableVatCents: res.expense.reclaimableVatCents,
      };
      setStep(res.duplicates.length > 0 ? { kind: 'duplicates', saved, duplicates: res.duplicates } : { kind: 'receipt', saved });
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onSubmit = handleSubmit((v) => {
    const qty = parseQty(v.stockQty);
    if (qty !== null && product && !product.trackStock) {
      setError('productId', { message: t('validation.notTracked') });
      return;
    }
    const bp = parseRateBp(v.vatRateBp);
    const pct = parsePct(v.businessUsePct);
    if (bp === null || pct === null) return;
    const payload: ExpensePayload = {
      expenseDate: v.expenseDate || null,
      categoryId: Number(v.categoryId),
      description: v.description.trim(),
      vendor: v.vendor.trim() || null,
      qtyText: v.qtyText.trim() || null,
      grossCents: parseCents(v.amount),
      vatRateBp: bp,
      hasValidReceipt: v.hasValidReceipt,
      businessUsePct: pct,
      paidById: v.paidById ? Number(v.paidById) : null,
      jointReinvested: v.jointReinvested,
      unitId: v.unitId ? Number(v.unitId) : null,
      productId: v.productId ? Number(v.productId) : null,
      purchasedFor: v.purchasedFor.trim() || null,
      notes: v.notes.trim() || null,
    };
    // Edit: an empty quantity keeps what this expense already received into stock.
    if (qty !== null) payload.stockQty = qty;
    else if (!isEdit) payload.stockQty = null;
    save.mutate(payload);
  });

  const startAnother = () => {
    rateTouched.current = false;
    setProduct(null);
    reset(blankValues(lookups, getValues('expenseDate') || today, getValues('paidById')));
    setStep({ kind: 'form' });
  };

  if (step.kind === 'duplicates') {
    return (
      <DuplicateWarningDialog
        expenseId={step.saved.id}
        duplicates={step.duplicates}
        onKeep={() => setStep({ kind: 'receipt', saved: step.saved })}
        onVoided={() => {
          invalidateAll(true, true);
          onClose();
        }}
      />
    );
  }

  if (step.kind === 'receipt') {
    return (
      <Dialog
        open
        onClose={onClose}
        title={t('form.savedTitle')}
        footer={
          <>
            <Button variant="outline" onClick={startAnother}>
              {t('form.addAnother')}
            </Button>
            <Button onClick={onClose}>{t('form.done')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-profit/40 bg-profit/10 p-3 text-sm" role="status">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-profit" aria-hidden />
            <div className="space-y-0.5">
              <p className="font-semibold text-profit">
                {t('form.savedLine', { id: step.saved.id, description: step.saved.description, amount: fmtEUR(step.saved.grossCents) })}
              </p>
              <p className="text-foreground/90">{t('form.savedReclaim', { amount: fmtEUR(step.saved.reclaimableVatCents) })}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <h3 className="text-sm font-semibold">{t('receipt.title')}</h3>
            <ReceiptUploader expenseId={step.saved.id} existing={[]} />
          </div>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      wide
      onClose={() => (save.isPending ? undefined : onClose())}
      title={expense ? t('form.editTitle', { id: expense.id }) : t('form.newTitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending} className="min-w-28">
            {save.isPending ? t('form.saving') : t('common:action.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        {expense?.needsReview ? (
          <p className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300" role="note">
            {t('form.reviewNote', { reason: expense.reviewReason ?? t('common:common.needsReview') })}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('common:common.date')}
            error={errors.expenseDate?.message}
            required={!isEdit}
            hint={isEdit ? t('form.dateOptionalHint') : undefined}
          >
            <Input type="date" aria-label={t('common:common.date')} {...register('expenseDate')} />
          </Field>
          <Field label={t('form.category')} error={errors.categoryId?.message} required>
            <Select aria-label={t('form.category')} {...register('categoryId')}>
              <option value="">{t('form.selectCategory')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryLabel(c, lang)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('form.description')} error={errors.description?.message} required>
            <Input aria-label={t('form.description')} placeholder={t('form.descriptionPlaceholder')} {...register('description')} />
          </Field>
          <Field label={t('form.vendor')} error={errors.vendor?.message} hint={t('form.vendorHint')}>
            <Input aria-label={t('form.vendor')} placeholder={t('form.vendorPlaceholder')} {...register('vendor')} />
          </Field>

          <Field
            label={t('form.amount')}
            error={errors.amount?.message}
            required={!isEdit}
            hint={isEdit ? t('form.amountOptionalHint') : undefined}
          >
            <Input inputMode="decimal" placeholder="0,00" aria-label={t('form.amount')} {...register('amount')} />
          </Field>
          <Field label={t('common:money.vatRate')} error={errors.vatRateBp?.message} required>
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

          <div className="space-y-1 self-end pb-1">
            <Controller
              control={control}
              name="hasValidReceipt"
              render={({ field }) => (
                <Checkbox
                  label={t('form.validReceipt')}
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                />
              )}
            />
            {!values.hasValidReceipt ? <p className="text-2xs text-muted-foreground">{t('form.noReceiptHint')}</p> : null}
          </div>
          <Field label={t('form.businessUse')} error={errors.businessUsePct?.message} hint={t('form.businessUseHint')}>
            <Input inputMode="numeric" aria-label={t('form.businessUse')} className="max-w-[8rem]" {...register('businessUsePct')} />
          </Field>

          <Field label={t('common:money.paidBy')} hint={t('form.paidByHint')}>
            <Select aria-label={t('common:money.paidBy')} {...register('paidById')}>
              <option value="">{t('form.notSet')}</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-1 self-end pb-1">
            <Controller
              control={control}
              name="jointReinvested"
              render={({ field }) => (
                <Checkbox
                  label={t('form.jointReinvested')}
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                />
              )}
            />
            <p className="text-2xs text-muted-foreground">
              {values.jointReinvested
                ? t('form.investmentJoint')
                : selectedPaidBy?.kind === 'PARTNER'
                  ? t('form.investmentPartner', { name: selectedPaidBy.name })
                  : t('form.jointHint')}
            </p>
          </div>

          <Field label={t('form.unit')} hint={t('form.unitHint')}>
            <UnitSelect
              label={t('form.unit')}
              value={values.unitId ? Number(values.unitId) : null}
              current={expense?.unit ?? null}
              emptyLabel={t('form.noUnit')}
              onChange={(id) => setValue('unitId', id === null ? '' : String(id), { shouldDirty: true })}
            />
          </Field>
          <Field label={t('form.purchasedFor')} error={errors.purchasedFor?.message} hint={t('form.purchasedForHint')}>
            <Input aria-label={t('form.purchasedFor')} {...register('purchasedFor')} />
          </Field>
        </div>

        {/* stock link: product + quantity → PURCHASE movement */}
        <fieldset className="space-y-3 rounded-lg border p-3">
          <legend className="px-1 text-xs font-semibold">{t('form.stockTitle')}</legend>
          <p className="text-2xs text-muted-foreground">{isEdit ? t('form.stockHintEdit') : t('form.stockHint')}</p>
          <Field label={t('form.product')} error={errors.productId?.message}>
            <ProductSelect
              label={t('form.product')}
              value={product}
              invalid={Boolean(errors.productId)}
              onChange={(p) => {
                setProduct(p);
                setValue('productId', p ? String(p.id) : '', { shouldDirty: true });
              }}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={t('form.stockQty')}
              error={errors.stockQty?.message}
              hint={isEdit ? t('form.stockQtyEditHint') : t('form.stockQtyHint')}
            >
              <Input inputMode="numeric" aria-label={t('form.stockQty')} className="max-w-[8rem]" {...register('stockQty')} />
            </Field>
            <Field label={t('form.qtyText')} error={errors.qtyText?.message} hint={t('form.qtyTextHint')}>
              <Input aria-label={t('form.qtyText')} placeholder={t('form.qtyTextPlaceholder')} {...register('qtyText')} />
            </Field>
          </div>
        </fieldset>

        <Field label={t('common:common.notes')} error={errors.notes?.message}>
          <Textarea rows={2} aria-label={t('common:common.notes')} {...register('notes')} />
        </Field>

        {/* live reclaimable-VAT preview (shared reclaimableVat) */}
        <section aria-label={t('preview.title')} className="rounded-lg border bg-muted/30 p-3" aria-live="polite">
          <h3 className="mb-2 text-xs font-semibold">{t('preview.title')}</h3>
          {preview && grossCents !== null && rateBp !== null && usePct !== null ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
              <PreviewItem label={t('preview.gross')} value={fmtEUR(grossCents)} strong />
              <PreviewItem
                label={`${t('preview.vatInPrice')} (${fmtPct(bpToPct(rateBp), rateBp % 100 === 0 ? 0 : 1)})`}
                value={fmtEUR(preview.vatInPrice)}
              />
              <PreviewItem label={t('form.businessUse')} value={fmtPct(usePct, 0)} />
              <PreviewItem label={t('preview.reclaimable')} value={fmtEUR(preview.reclaim)} strong tone={preview.reclaim > 0 ? 'profit' : undefined} />
              <PreviewItem label={t('preview.costAfterReclaim')} value={fmtEUR(grossCents - preview.reclaim)} />
              {stockQty !== null && product ? (
                <PreviewItem label={t('preview.unitCost', { qty: stockQty })} value={fmtEUR(roundHalfAwayFromZero(grossCents / stockQty))} />
              ) : null}
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">{t('preview.empty')}</p>
          )}
          {preview && !values.hasValidReceipt ? <p className="mt-2 text-2xs text-muted-foreground">{t('preview.noReceipt')}</p> : null}
        </section>

        {expense ? (
          <div className="space-y-1.5 border-t pt-3">
            <h3 className="text-sm font-semibold">{t('receipt.title')}</h3>
            <ReceiptUploader expenseId={expense.id} existing={expense.attachments} />
          </div>
        ) : (
          <p className="text-2xs text-muted-foreground">{t('form.receiptAfterSave')}</p>
        )}
      </form>
    </Dialog>
  );
}

function PreviewItem({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: 'profit' }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs text-muted-foreground">{label}</dt>
      <dd className={cn('tabular-nums', strong && 'font-semibold', tone === 'profit' && 'text-profit')}>{value}</dd>
    </div>
  );
}
