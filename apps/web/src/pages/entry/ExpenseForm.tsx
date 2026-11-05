import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, Paperclip, X } from 'lucide-react';
import { bpToPct, reclaimableVat, splitGross, todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { fmtEUR, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import { UnitPicker } from './Pickers';
import { PreviewCard, type PreviewRow } from './PreviewCard';
import { DuplicatesDialog } from './DuplicatesDialog';
import {
  categoryLabel,
  defaultRateBp,
  parseCents,
  parseRateBp,
  vatOptionsOn,
  vatRateLabel,
  type ExpenseDuplicate,
  type Lookups,
} from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,application/pdf';

interface ExpenseValues {
  expenseDate: string;
  categoryId: string;
  description: string;
  vendor: string;
  amount: string;
  vatRateBp: string;
  hasValidReceipt: boolean;
  businessUsePct: string;
  paidById: string;
  jointReinvested: boolean;
  unitId: string;
  notes: string;
}

interface CreateExpensePayload {
  expenseDate: string;
  categoryId: number;
  description: string;
  vendor: string | null;
  grossCents: number;
  vatRateBp: number;
  hasValidReceipt: boolean;
  businessUsePct: number;
  paidById: number | null;
  jointReinvested: boolean;
  unitId: number | null;
  notes: string | null;
}

interface CreateExpenseResponse {
  expense: { id: number; description: string; grossCents: number | null; reclaimableVatCents: number };
  duplicates: ExpenseDuplicate[];
}

interface SavedExpense {
  id: number;
  description: string;
  grossCents: number;
  reclaimableCents: number;
  receipt: 'none' | 'uploading' | 'uploaded' | 'failed';
  receiptName: string | null;
  voided: boolean;
}

function parsePct(value: string): number | null {
  if (!/^\d{1,3}$/.test(value.trim())) return null;
  const n = Number(value.trim());
  return n >= 0 && n <= 100 ? n : null;
}

function emptyExpense(expenseDate: string, rateBp: number, paidById: string): ExpenseValues {
  return {
    expenseDate,
    categoryId: '',
    description: '',
    vendor: '',
    amount: '',
    vatRateBp: String(rateBp),
    hasValidReceipt: false,
    businessUsePct: '100',
    paidById,
    jointReinvested: false,
    unitId: '',
    notes: '',
  };
}

/** EXPENSE tab — POST /expenses, receipt upload (POST /attachments), duplicate warning. */
export function ExpenseForm({ lookups }: { lookups: Lookups }) {
  const { t, i18n } = useTranslation('entry');
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const rateTouched = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedExpense | null>(null);
  const [dupes, setDupes] = useState<{ expenseId: number; duplicates: ExpenseDuplicate[] } | null>(null);

  const schema = useMemo(
    () =>
      z
        .object({
          expenseDate: z.string().regex(ISO_DATE_RE, t('validation.dateRequired')),
          categoryId: z.string().min(1, t('validation.categoryRequired')),
          description: z.string().trim().min(1, t('validation.descriptionRequired')).max(500, t('validation.tooLong')),
          vendor: z.string().max(200, t('validation.tooLong')),
          amount: z.string(),
          vatRateBp: z.string().min(1, t('validation.rateRequired')),
          hasValidReceipt: z.boolean(),
          businessUsePct: z.string(),
          paidById: z.string(),
          jointReinvested: z.boolean(),
          unitId: z.string(),
          notes: z.string().max(2000, t('validation.tooLong')),
        })
        .superRefine((v, ctx) => {
          const amount = parseCents(v.amount);
          if (amount === null || amount === 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: t('validation.amountInvalid') });
          }
          if (parsePct(v.businessUsePct) === null) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['businessUsePct'], message: t('validation.pctInvalid') });
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
  } = useForm<ExpenseValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyExpense(today, defaultRateBp(lookups.vatRates, today), ''),
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
  const rateOptions = vatOptionsOn(lookups.vatRates, values.expenseDate, rateBp ?? undefined);

  const previewRows: PreviewRow[] | null =
    grossCents !== null && rateBp !== null && usePct !== null
      ? ((): PreviewRow[] => {
          const vatInPrice = splitGross(grossCents, rateBp).vatCents;
          const reclaim = reclaimableVat({
            grossCents,
            rateBp,
            hasValidReceipt: values.hasValidReceipt,
            businessUsePct: usePct,
          });
          return [
            { key: 'gross', label: t('preview.expenseGross'), value: fmtEUR(grossCents), strong: true },
            {
              key: 'vatIn',
              label: `${t('preview.vatInPrice')} (${fmtPct(bpToPct(rateBp), rateBp % 100 === 0 ? 0 : 1)})`,
              value: fmtEUR(vatInPrice),
              muted: true,
            },
            { key: 'use', label: t('fields.businessUse'), value: fmtPct(usePct, 0), muted: true },
            {
              key: 'reclaim',
              label: t('preview.reclaimable'),
              value: fmtEUR(reclaim),
              strong: true,
              tone: reclaim > 0 ? 'profit' : undefined,
            },
            { key: 'cost', label: t('preview.costAfterReclaim'), value: fmtEUR(grossCents - reclaim) },
          ];
        })()
      : null;

  const invalidateAll = (withUnits: boolean) => {
    void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['vat'] });
    void queryClient.invalidateQueries({ queryKey: ['investments'] });
    void queryClient.invalidateQueries({ queryKey: ['partners'] });
    if (withUnits) void queryClient.invalidateQueries({ queryKey: ['units'] });
  };

  const upload = useMutation({
    mutationFn: ({ expenseId, file }: { expenseId: number; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('expenseId', String(expenseId));
      return api.post<unknown>('/attachments', fd);
    },
    onMutate: ({ file }) => setSaved((s) => (s ? { ...s, receipt: 'uploading', receiptName: file.name } : s)),
    onSuccess: () => {
      toast.success(t('expense.receiptUploaded'));
      setSaved((s) => (s ? { ...s, receipt: 'uploaded' } : s));
      void queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: (err) => {
      toast.error(t('expense.receiptFailed', { message: err instanceof Error ? err.message : '' }));
      setSaved((s) => (s ? { ...s, receipt: 'failed' } : s));
    },
  });

  const clearFile = () => {
    setReceipt(null);
    setFileError(null);
    if (fileInput.current) fileInput.current.value = '';
  };

  const save = useMutation({
    mutationFn: ({ payload }: { payload: CreateExpensePayload; file: File | null }) =>
      api.post<CreateExpenseResponse>('/expenses', payload),
    onSuccess: (res, { payload, file }) => {
      toast.success(t('common:common.savedOk'));
      invalidateAll(payload.unitId !== null);
      setSaved({
        id: res.expense.id,
        description: res.expense.description,
        grossCents: res.expense.grossCents ?? payload.grossCents,
        reclaimableCents: res.expense.reclaimableVatCents,
        receipt: file ? 'uploading' : 'none',
        receiptName: file?.name ?? null,
        voided: false,
      });
      if (file) upload.mutate({ expenseId: res.expense.id, file });
      if (res.duplicates.length > 0) setDupes({ expenseId: res.expense.id, duplicates: res.duplicates });
      rateTouched.current = false;
      clearFile();
      reset(emptyExpense(payload.expenseDate, defaultRateBp(lookups.vatRates, payload.expenseDate), getValues('paidById')));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('common:common.errorTitle')),
  });

  const onSubmit = handleSubmit((v) => {
    const gross = parseCents(v.amount);
    const bp = parseRateBp(v.vatRateBp);
    const pct = parsePct(v.businessUsePct);
    if (gross === null || bp === null || pct === null || fileError) return;
    save.mutate({
      payload: {
        expenseDate: v.expenseDate,
        categoryId: Number(v.categoryId),
        description: v.description.trim(),
        vendor: v.vendor.trim() || null,
        grossCents: gross,
        vatRateBp: bp,
        hasValidReceipt: v.hasValidReceipt,
        businessUsePct: pct,
        paidById: v.paidById ? Number(v.paidById) : null,
        jointReinvested: v.jointReinvested,
        unitId: v.unitId ? Number(v.unitId) : null,
        notes: v.notes.trim() || null,
      },
      file: receipt,
    });
  });

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_FILE_BYTES) {
      setReceipt(null);
      setFileError(t('expense.fileTooLarge'));
      e.target.value = '';
      return;
    }
    setFileError(null);
    setReceipt(file);
  };

  const onRetryPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !saved) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t('expense.fileTooLarge'));
      return;
    }
    upload.mutate({ expenseId: saved.id, file });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {saved ? (
          <div
            className={
              saved.voided
                ? 'flex items-start gap-3 rounded-lg border bg-muted/50 p-3 text-sm'
                : 'flex items-start gap-3 rounded-lg border border-profit/40 bg-profit/10 p-3 text-sm'
            }
            role="status"
          >
            <CheckCircle2 className={saved.voided ? 'mt-0.5 h-5 w-5 shrink-0 text-muted-foreground' : 'mt-0.5 h-5 w-5 shrink-0 text-profit'} aria-hidden />
            <div className="min-w-0 flex-1 space-y-1">
              <p className={saved.voided ? 'font-semibold text-muted-foreground line-through' : 'font-semibold text-profit'}>
                {t('expense.success.title', { amount: fmtEUR(saved.grossCents), description: saved.description })}
              </p>
              {saved.voided ? (
                <p className="text-xs text-muted-foreground">{t('expense.success.voided')}</p>
              ) : (
                <>
                  <p className="text-foreground/90">{t('expense.success.reclaim', { amount: fmtEUR(saved.reclaimableCents) })}</p>
                  {saved.receipt === 'uploading' ? (
                    <p className="text-xs text-muted-foreground">{t('expense.success.receiptUploading', { name: saved.receiptName })}</p>
                  ) : saved.receipt === 'uploaded' ? (
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip className="h-3.5 w-3.5" aria-hidden /> {saved.receiptName}
                    </p>
                  ) : saved.receipt === 'failed' ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-destructive">{t('expense.success.receiptRetry')}</p>
                      <Input
                        type="file"
                        accept={RECEIPT_ACCEPT}
                        onChange={onRetryPicked}
                        disabled={upload.isPending}
                        aria-label={t('expense.receipt')}
                        className="h-auto py-1 text-xs"
                      />
                    </div>
                  ) : null}
                </>
              )}
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSaved(null)} aria-label={t('common:action.close')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <Card>
          <CardContent className="pt-4">
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('common:common.date')} error={errors.expenseDate?.message} required>
                  <Input type="date" aria-label={t('common:common.date')} {...register('expenseDate')} />
                </Field>
                <Field label={t('fields.category')} error={errors.categoryId?.message} required>
                  <Select aria-label={t('fields.category')} {...register('categoryId')}>
                    <option value="">{t('expense.selectCategory')}</option>
                    {lookups.expenseCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {categoryLabel(c, lang)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('fields.description')} error={errors.description?.message} required>
                  <Input aria-label={t('fields.description')} placeholder={t('expense.descriptionPlaceholder')} {...register('description')} />
                </Field>
                <Field label={t('fields.vendor')} error={errors.vendor?.message}>
                  <Input aria-label={t('fields.vendor')} placeholder={t('expense.vendorPlaceholder')} {...register('vendor')} />
                </Field>

                <Field label={t('expense.amount')} error={errors.amount?.message} required>
                  <Input inputMode="decimal" placeholder="0,00" aria-label={t('expense.amount')} {...register('amount')} />
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
                        label={t('expense.validReceipt')}
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                  {!values.hasValidReceipt ? <p className="text-2xs text-muted-foreground">{t('expense.noReceiptHint')}</p> : null}
                </div>
                <Field label={t('fields.businessUse')} error={errors.businessUsePct?.message} hint={t('expense.businessUseHint')}>
                  <Input
                    inputMode="numeric"
                    aria-label={t('fields.businessUse')}
                    className="max-w-[8rem]"
                    {...register('businessUsePct')}
                  />
                </Field>

                <Field label={t('common:money.paidBy')} hint={t('expense.paidByHint')}>
                  <Select aria-label={t('common:money.paidBy')} {...register('paidById')}>
                    <option value="">{t('fields.notSet')}</option>
                    {lookups.holders.map((h) => (
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
                        label={t('expense.jointReinvested')}
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                        onBlur={field.onBlur}
                      />
                    )}
                  />
                  <p className="text-2xs text-muted-foreground">{t('expense.jointHint')}</p>
                </div>

                <Field label={t('fields.unit')} hint={t('expense.unitHint')}>
                  <UnitPicker
                    label={t('fields.unit')}
                    value={values.unitId ? Number(values.unitId) : null}
                    onChange={(id) => setValue('unitId', id === null ? '' : String(id))}
                  />
                </Field>
                <Field label={t('expense.receipt')} error={fileError ?? undefined} hint={t('expense.receiptHint')}>
                  <div className="flex items-center gap-2">
                    <Input
                      ref={fileInput}
                      type="file"
                      accept={RECEIPT_ACCEPT}
                      onChange={onFilePicked}
                      aria-label={t('expense.receipt')}
                      className="h-auto py-1 text-xs"
                    />
                    {receipt ? (
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={clearFile} aria-label={t('expense.removeReceipt')}>
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </Field>

                <Field label={t('common:common.notes')} error={errors.notes?.message} className="sm:col-span-2">
                  <Textarea rows={2} aria-label={t('common:common.notes')} {...register('notes')} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => {
                    rateTouched.current = false;
                    clearFile();
                    reset(emptyExpense(getValues('expenseDate'), defaultRateBp(lookups.vatRates, getValues('expenseDate')), getValues('paidById')));
                  }}
                  disabled={save.isPending}
                >
                  {t('actions.clear')}
                </Button>
                <Button type="submit" size="lg" disabled={save.isPending} className="min-w-40">
                  {save.isPending ? t('actions.saving') : t('expense.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <PreviewCard title={t('preview.expenseTitle')} description={t('preview.expenseHint')} rows={previewRows} emptyText={t('preview.empty')} />

      <DuplicatesDialog
        state={dupes}
        onClose={() => setDupes(null)}
        onVoided={(expenseId) => {
          setDupes(null);
          setSaved((s) => (s && s.id === expenseId ? { ...s, voided: true } : s));
          invalidateAll(true);
        }}
      />
    </div>
  );
}
