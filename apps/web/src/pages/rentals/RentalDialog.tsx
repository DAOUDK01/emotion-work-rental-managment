import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Paperclip, X } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, qs } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, ErrorState, LoadingState } from '@/components/ui/misc';
import {
  errorMessage,
  PAYMENT_STATUSES,
  suggestPeriodText,
  type CustomerLite,
  type Lookups,
  type PaymentStatus,
  type RentalDetail,
  type SaveRentalPayload,
  type UnitLite,
} from './types';

interface FormValues {
  unitId: string;
  customerName: string;
  handOverDate: string;
  startDate: string;
  endDate: string;
  periodText: string;
  amount: string;
  deposit: string;
  discount: string;
  discountReason: string;
  vatInvoice: boolean;
  paymentStatus: PaymentStatus;
  paymentMethodId: string;
  receivedById: string;
  recurring: boolean;
  agreementSigned: boolean;
  notes: string;
}

function emptyValues(today: string): FormValues {
  return {
    unitId: '',
    customerName: '',
    handOverDate: '',
    startDate: today,
    endDate: '',
    periodText: suggestPeriodText(today, null),
    amount: '',
    deposit: '',
    discount: '',
    discountReason: '',
    vatInvoice: false,
    paymentStatus: 'NOT_YET_BILLED',
    paymentMethodId: '',
    receivedById: '',
    recurring: false,
    agreementSigned: false,
    notes: '',
  };
}

function detailToValues(r: RentalDetail): FormValues {
  return {
    unitId: String(r.unit.id),
    customerName: r.customer ? '' : (r.customerName ?? ''),
    handOverDate: r.handOverDate ?? '',
    startDate: r.startDate,
    endDate: r.endDate ?? '',
    periodText: r.periodText ?? '',
    amount: centsToInput(r.amountCents),
    deposit: r.depositCents ? centsToInput(r.depositCents) : '',
    discount: r.entry && r.entry.discountCents > 0 ? centsToInput(r.entry.discountCents) : '',
    discountReason: r.entry?.discountReason ?? '',
    vatInvoice: r.vatInvoice,
    paymentStatus: r.paymentStatus ?? 'NOT_YET_BILLED',
    paymentMethodId: r.entry?.paymentMethod ? String(r.entry.paymentMethod.id) : '',
    receivedById: r.receivedBy ? String(r.receivedBy.id) : '',
    recurring: r.recurring,
    agreementSigned: r.agreementSigned,
    notes: r.notes ?? '',
  };
}

/** Create / edit dialog — POST /rentals or PUT /rentals/:id (the API rewrites the linked entry). */
export default function RentalDialog({
  open,
  rentalId,
  units,
  lookups,
  onClose,
}: {
  open: boolean;
  /** null = create */
  rentalId: number | null;
  units: UnitLite[];
  lookups: Lookups | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('rentals');
  const queryClient = useQueryClient();
  /** true once the user typed their own period text — stop auto-suggesting. */
  const periodEdited = useRef(false);
  /** Which rental the form was last filled from (prevents refetches wiping unsaved edits). */
  const prefilledFor = useRef<number | 'new' | null>(null);
  const [linkedCustomer, setLinkedCustomer] = useState<CustomerLite | null>(null);
  /** After a successful create the dialog stays open to attach the signed agreement. */
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);

  const schema = useMemo(
    () =>
      z
        .object({
          unitId: z.string().min(1, t('form.validation.unitRequired')),
          customerName: z.string().max(120, t('form.validation.tooLong')),
          handOverDate: z.string(),
          startDate: z.string().min(1, t('form.validation.startRequired')),
          endDate: z.string(),
          periodText: z.string().max(60, t('form.validation.tooLong')),
          amount: z.string().min(1, t('form.validation.amountInvalid')),
          deposit: z.string(),
          discount: z.string(),
          discountReason: z.string().max(200, t('form.validation.tooLong')),
          vatInvoice: z.boolean(),
          paymentStatus: z.enum(['PAID', 'INVOICED', 'PENDING', 'NOT_YET_BILLED']),
          paymentMethodId: z.string(),
          receivedById: z.string(),
          recurring: z.boolean(),
          agreementSigned: z.boolean(),
          notes: z.string().max(2000, t('form.validation.tooLong')),
        })
        .superRefine((v, ctx) => {
          const amount = euroInputToCents(v.amount);
          if (amount === null || amount < 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: t('form.validation.amountInvalid') });
          }
          const deposit = v.deposit.trim() ? euroInputToCents(v.deposit) : 0;
          if (deposit === null || deposit < 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['deposit'], message: t('form.validation.amountInvalid') });
          }
          const discount = v.discount.trim() ? euroInputToCents(v.discount) : 0;
          if (discount === null || discount < 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount'], message: t('form.validation.amountInvalid') });
          } else if (amount !== null && discount > amount) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['discount'], message: t('form.validation.discountTooBig') });
          }
          if (v.endDate && v.startDate && v.endDate < v.startDate) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: t('form.validation.endBeforeStart') });
          }
          if (v.paymentStatus === 'PAID' && !v.receivedById) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['receivedById'],
              message: t('form.validation.receivedByRequired'),
            });
          }
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
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: emptyValues(todayInHelsinki()) });

  const detail = useQuery({
    queryKey: ['rentals', rentalId],
    queryFn: () => api.get<{ rental: RentalDetail }>(`/rentals/${rentalId}`),
    enabled: open && rentalId !== null,
  });

  // ---- reset (create) / prefill (edit) once per opening
  useEffect(() => {
    if (!open) {
      prefilledFor.current = null;
      return;
    }
    const key = rentalId ?? 'new';
    if (prefilledFor.current === key) return;
    if (rentalId === null) {
      prefilledFor.current = key;
      periodEdited.current = false;
      setCreatedId(null);
      setUploadedNames([]);
      setLinkedCustomer(null);
      reset(emptyValues(todayInHelsinki()));
      return;
    }
    const r = detail.data?.rental;
    if (!r || r.id !== rentalId) return;
    prefilledFor.current = key;
    periodEdited.current = true; // keep the stored period text until the dates are changed on purpose
    setCreatedId(null);
    setUploadedNames([]);
    setLinkedCustomer(r.customer);
    reset(detailToValues(r));
  }, [open, rentalId, detail.data, reset]);

  // ---- period text auto-suggest "DD.MM TO DD.MM" from the dates (until typed by hand)
  const startDate = watch('startDate');
  const endDate = watch('endDate');
  useEffect(() => {
    if (!open || !startDate || periodEdited.current) return;
    const suggestion = suggestPeriodText(startDate, endDate || null);
    if (suggestion) setValue('periodText', suggestion);
  }, [open, startDate, endDate, setValue]);

  // ---- customer: search-and-link, free text as the fallback
  const customerText = watch('customerName');
  const [customerQ, setCustomerQ] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setCustomerQ(customerText.trim()), 300);
    return () => clearTimeout(h);
  }, [customerText]);
  const customers = useQuery({
    queryKey: ['customers', 'search', customerQ],
    queryFn: () => api.get<{ customers: CustomerLite[] }>('/customers' + qs({ q: customerQ, pageSize: 8 })),
    enabled: open && !linkedCustomer && customerQ.length >= 2,
    staleTime: 30_000,
  });
  const customerMatches = customers.data?.customers ?? [];

  const paymentStatus = watch('paymentStatus');
  const vatInvoice = watch('vatInvoice');
  const recurring = watch('recurring');
  const agreementSigned = watch('agreementSigned');
  const unitIdValue = watch('unitId');

  const currentUnit = detail.data?.rental.unit;
  const unitOptions = useMemo<UnitLite[]>(() => {
    const rentable = units.filter((u) => (u.status !== 'SOLD' && u.status !== 'DISPOSED') || String(u.id) === unitIdValue);
    // the rental's own unit may no longer be listed (archived) — keep it selectable when editing
    if (rentalId !== null && currentUnit && !rentable.some((u) => u.id === currentUnit.id)) {
      const fallback: UnitLite = { ...currentUnit, status: 'ON_RENT' };
      rentable.unshift(units.find((u) => u.id === currentUnit.id) ?? fallback);
    }
    return rentable;
  }, [units, unitIdValue, rentalId, currentUnit]);
  const selectedUnit = unitOptions.find((u) => String(u.id) === unitIdValue);
  const isOwnUnit = rentalId !== null && currentUnit?.id === selectedUnit?.id;

  // ---- save
  const save = useMutation({
    mutationFn: (payload: SaveRentalPayload) =>
      rentalId === null
        ? api.post<{ rental: RentalDetail }>('/rentals', payload)
        : api.put<{ rental: RentalDetail }>(`/rentals/${rentalId}`, payload),
    onSuccess: (res) => {
      toast.success(t('common:common.savedOk'));
      void queryClient.invalidateQueries({ queryKey: ['rentals'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      if (rentalId === null) setCreatedId(res.rental.id); // stay open → attach the agreement
      else onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onSubmit = handleSubmit((v) => {
    const payload: SaveRentalPayload = {
      unitId: Number(v.unitId),
      customerId: linkedCustomer?.id ?? null,
      customerName: linkedCustomer ? null : v.customerName.trim() || null,
      handOverDate: v.handOverDate || null,
      startDate: v.startDate,
      endDate: v.endDate || null,
      periodText: v.periodText.trim() || null,
      amountCents: euroInputToCents(v.amount) ?? 0,
      depositCents: v.deposit.trim() ? (euroInputToCents(v.deposit) ?? 0) : 0,
      discountCents: v.discount.trim() ? (euroInputToCents(v.discount) ?? 0) : 0,
      discountReason: v.discountReason.trim() || null,
      vatInvoice: v.vatInvoice,
      paymentStatus: v.paymentStatus,
      paymentMethodId: v.paymentMethodId ? Number(v.paymentMethodId) : null,
      receivedById: v.receivedById ? Number(v.receivedById) : null,
      recurring: v.recurring,
      agreementSigned: v.agreementSigned,
      notes: v.notes.trim() || null,
    };
    save.mutate(payload);
  });

  // ---- agreement upload (after save): POST /attachments { file, rentalId }
  const uploadTargetId = createdId ?? rentalId;
  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('rentalId', String(uploadTargetId));
      return api.post<unknown>('/attachments', fd);
    },
    onSuccess: (_res, file) => {
      toast.success(t('toasts.agreementUploaded'));
      setUploadedNames((names) => [...names, file.name]);
      void queryClient.invalidateQueries({ queryKey: ['rentals'] });
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && uploadTargetId !== null) upload.mutate(file);
    e.target.value = '';
  };

  const onReceiverChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const holder = lookups?.holders.find((h) => String(h.id) === e.target.value);
    if (holder) setValue('vatInvoice', lookups?.vatDefaults.byHolder[holder.name] ?? false);
  };

  const existingAttachments = rentalId !== null ? (detail.data?.rental.attachments ?? []) : [];
  const title = rentalId !== null && createdId === null ? t('form.editTitle') : t('form.createTitle');
  const busy = save.isPending || upload.isPending;

  const uploadList = (
    <ul className="space-y-1 text-sm">
      {existingAttachments.map((a) => (
        <li key={a.id} className="flex items-center gap-1.5 text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{a.fileName}</span>
          <span className="text-2xs">({fmtDate(a.createdAt)})</span>
        </li>
      ))}
      {uploadedNames.map((name, i) => (
        <li key={`new-${name}-${i}`} className="flex items-center gap-1.5 text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden /> <span className="truncate">{name}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <Dialog open={open} onClose={busy ? () => undefined : onClose} title={title} wide>
      {createdId !== null ? (
        // ---------- step 2 after create: attach the signed agreement ----------
        <div className="space-y-3">
          <p className="rounded-md bg-profit/10 px-3 py-2 text-sm font-medium text-profit" role="status">
            {t('form.savedNowUpload')}
          </p>
          <Field label={t('form.attachments')} hint={upload.isPending ? t('form.uploading') : t('form.uploadHint')}>
            <Input type="file" accept="application/pdf,image/*" onChange={onFilePicked} disabled={upload.isPending} />
          </Field>
          {uploadedNames.length > 0 ? uploadList : null}
          <div className="flex justify-end">
            <Button onClick={onClose} disabled={upload.isPending}>
              {uploadedNames.length > 0 ? t('common:action.close') : t('form.skipUpload')}
            </Button>
          </div>
        </div>
      ) : rentalId !== null && detail.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : rentalId !== null && detail.isError ? (
        <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* unit */}
            <Field label={t('form.unit')} error={errors.unitId?.message} required className="sm:col-span-2">
              <div className="flex items-center gap-2">
                <Select aria-label={t('form.unit')} {...register('unitId')}>
                  <option value="">{t('form.selectUnit')}</option>
                  {unitOptions.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.brand} ({t(`unitStatus.${u.status}`)})
                    </option>
                  ))}
                </Select>
                {selectedUnit ? (
                  <Badge variant={selectedUnit.status === 'AVAILABLE' ? 'success' : 'warning'} className="shrink-0">
                    {t(`unitStatus.${selectedUnit.status}`)}
                  </Badge>
                ) : null}
              </div>
              {selectedUnit && selectedUnit.status !== 'AVAILABLE' && !isOwnUnit ? (
                <p className="text-2xs font-medium text-amber-700 dark:text-amber-400" role="alert">
                  {t('form.unitNotAvailable', { status: t(`unitStatus.${selectedUnit.status}`) })}
                </p>
              ) : null}
            </Field>

            {/* customer: linked (search) OR free text */}
            <Field
              label={t('form.customer')}
              className="sm:col-span-2"
              error={errors.customerName?.message}
              hint={linkedCustomer ? t('form.linkedHint') : customerText.trim() ? t('form.freeTextHint') : t('form.customerHint')}
            >
              {linkedCustomer ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="info">{linkedCustomer.name}</Badge>
                  <span className="text-2xs text-muted-foreground">{t(`customerType.${linkedCustomer.type}`)}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLinkedCustomer(null);
                      setValue('customerName', '');
                    }}
                  >
                    <X className="h-3.5 w-3.5" aria-hidden /> {t('form.unlink')}
                  </Button>
                </div>
              ) : (
                <>
                  <Input placeholder={t('form.customerPlaceholder')} autoComplete="off" {...register('customerName')} />
                  {customers.isFetching && customerMatches.length === 0 ? (
                    <p className="text-2xs text-muted-foreground">{t('form.searching')}</p>
                  ) : null}
                  {customerMatches.length > 0 ? (
                    <div className="mt-1 overflow-hidden rounded-md border" role="listbox" aria-label={t('form.customerMatches')}>
                      {customerMatches.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          role="option"
                          aria-selected={false}
                          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                          onClick={() => {
                            setLinkedCustomer(c);
                            setValue('customerName', '');
                          }}
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0 text-2xs text-muted-foreground">{t('form.linkCustomer')}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </Field>

            <Field label={t('form.handOverDate')} error={errors.handOverDate?.message}>
              <Input type="date" {...register('handOverDate')} />
            </Field>
            <Field label={t('form.startDate')} error={errors.startDate?.message} required>
              <Input
                type="date"
                {...register('startDate', {
                  onChange: () => {
                    periodEdited.current = false;
                  },
                })}
              />
            </Field>
            <Field label={t('form.endDate')} error={errors.endDate?.message} hint={t('form.openEnded')}>
              <Input
                type="date"
                {...register('endDate', {
                  onChange: () => {
                    periodEdited.current = false;
                  },
                })}
              />
            </Field>
            <Field label={t('form.periodText')} error={errors.periodText?.message} hint={t('form.periodHint')}>
              <Input
                {...register('periodText', {
                  onChange: () => {
                    periodEdited.current = true;
                  },
                })}
              />
            </Field>

            <Field label={t('common:common.amount')} error={errors.amount?.message} required>
              <Input inputMode="decimal" placeholder="0,00" {...register('amount')} />
            </Field>
            <Field label={t('form.deposit')} error={errors.deposit?.message}>
              <Input inputMode="decimal" placeholder="0,00" {...register('deposit')} />
            </Field>
            <Field label={t('common:money.discount')} error={errors.discount?.message}>
              <Input inputMode="decimal" placeholder="0,00" {...register('discount')} />
            </Field>
            <Field label={t('common:money.discountReason')} error={errors.discountReason?.message}>
              <Input {...register('discountReason')} />
            </Field>

            <Field label={t('form.paymentStatus')} error={errors.paymentStatus?.message}>
              <Select {...register('paymentStatus')}>
                {PAYMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`common:status.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common:money.paymentMethod')} error={errors.paymentMethodId?.message}>
              <Select {...register('paymentMethodId')}>
                <option value="">{t('common:common.none')}</option>
                {(lookups?.methods ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label={t('common:money.receivedBy')}
              error={errors.receivedById?.message}
              required={paymentStatus === 'PAID'}
              hint={paymentStatus === 'PAID' ? undefined : t('form.receivedByHint')}
              className="sm:col-span-2"
            >
              <Select {...register('receivedById', { onChange: onReceiverChange })}>
                <option value="">{t('common:common.none')}</option>
                {(lookups?.holders ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="space-y-2 sm:col-span-2">
              <Checkbox
                label={t('common:money.vatInvoice')}
                checked={vatInvoice}
                onChange={(e) => setValue('vatInvoice', e.target.checked, { shouldDirty: true })}
              />
              {!vatInvoice ? (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-2xs font-medium text-amber-800 dark:text-amber-300" role="note">
                  {t('common:money.vatWarning')}
                </p>
              ) : null}
              <Checkbox
                label={t('form.recurring')}
                checked={recurring}
                onChange={(e) => setValue('recurring', e.target.checked, { shouldDirty: true })}
              />
              <p className="pl-6 text-2xs text-muted-foreground">{t('form.recurringHint')}</p>
              <Checkbox
                label={t('form.agreementSigned')}
                checked={agreementSigned}
                onChange={(e) => setValue('agreementSigned', e.target.checked, { shouldDirty: true })}
              />
            </div>

            <Field label={t('common:common.notes')} error={errors.notes?.message} className="sm:col-span-2">
              <Textarea {...register('notes')} />
            </Field>
          </div>

          {/* agreement PDF / photo — uploadable once the rental exists */}
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-xs font-semibold">{t('form.attachments')}</p>
            {rentalId === null ? (
              <p className="text-2xs text-muted-foreground">{t('form.uploadAfterSave')}</p>
            ) : (
              <>
                {existingAttachments.length === 0 && uploadedNames.length === 0 ? (
                  <p className="text-2xs text-muted-foreground">{t('form.noAttachments')}</p>
                ) : (
                  uploadList
                )}
                <Input
                  type="file"
                  accept="application/pdf,image/*"
                  onChange={onFilePicked}
                  disabled={upload.isPending}
                  aria-label={t('form.upload')}
                />
                <p className="text-2xs text-muted-foreground">{upload.isPending ? t('form.uploading') : t('form.uploadHint')}</p>
              </>
            )}
          </div>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" disabled={busy}>
              {save.isPending ? t('form.saving') : t('common:action.save')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
