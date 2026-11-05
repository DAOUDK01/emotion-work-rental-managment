import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { creditedCents, remainingCents, type CustomerHit, type InvoiceDetail, type Lookups } from './types';

export const errorMessage = (err: unknown, fallback: string): string => (err instanceof Error ? err.message : fallback);

/** After any invoice mutation: refresh the detail cache + every list that shows invoice money. */
export function useInvoiceRefresh(): (invoice: InvoiceDetail) => void {
  const queryClient = useQueryClient();
  return (invoice: InvoiceDetail) => {
    queryClient.setQueryData(['invoices', invoice.id], { invoice });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    void queryClient.invalidateQueries({ queryKey: ['entries'] });
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
    void queryClient.invalidateQueries({ queryKey: ['cash'] });
  };
}

/** The invoice customer's card (for the e-mail address); detail payloads carry only id/name/type. */
function useCustomerEmail(customerId: number, enabled: boolean) {
  const q = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => api.get<{ customer: CustomerHit }>(`/customers/${customerId}`),
    enabled,
    retry: false,
  });
  return { email: q.data?.customer.email ?? null, loading: q.isLoading && enabled };
}

const emailSchema = (msg: string) =>
  z.object({ email: z.union([z.literal(''), z.string().trim().email(msg).max(200, msg)]) });
type EmailForm = { email: string };

// ---------------------------------------------------------------- send

/** DRAFT → SENT: confirms the (editable) customer e-mail and explains the income entry it creates. */
export function SendDialog({ invoice, open, onClose }: { invoice: InvoiceDetail; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('invoices');
  const refresh = useInvoiceRefresh();
  const { email: customerEmail, loading } = useCustomerEmail(invoice.customer.id, open);
  const schema = useMemo(() => emailSchema(t('validation.email')), [t]);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isDirty },
  } = useForm<EmailForm>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  // prefill from the customer card once it arrives, unless the user already typed something
  useEffect(() => {
    if (open && !isDirty) reset({ email: customerEmail ?? invoice.emailedTo ?? '' });
  }, [open, isDirty, customerEmail, invoice.emailedTo, reset]);
  useEffect(() => {
    if (!open) reset({ email: '' });
  }, [open, reset]);

  const send = useMutation({
    mutationFn: (email: string) =>
      api.post<{ invoice: InvoiceDetail; emailQueued: boolean }>(`/invoices/${invoice.id}/send`, {
        email: email || undefined,
      }),
    onSuccess: (res, email) => {
      refresh(res.invoice);
      toast.success(res.emailQueued ? t('send.doneEmailed', { email: email || res.invoice.emailedTo }) : t('send.doneNoEmail'));
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onSubmit = handleSubmit((values) => send.mutate(values.email.trim()));
  const email = watch('email');

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => void onSubmit()}
      title={t('send.title', { number: invoice.numberFormatted })}
      message={t('send.explain', { amount: fmtEUR(invoice.totalGrossCents) })}
      confirmLabel={email.trim() ? t('send.confirmEmail') : t('send.confirmNoEmail')}
      destructive={false}
      busy={send.isPending || loading}
    >
      <form
        className="mt-3 space-y-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Field
          label={t('send.email')}
          error={errors.email?.message}
          hint={email.trim() ? t('send.emailHint') : t('send.noEmailHint')}
        >
          <Input type="email" autoComplete="off" aria-label={t('send.email')} {...register('email')} />
        </Field>
      </form>
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- remind

/** Overdue invoices: queue a reminder e-mail (defaults to the customer's address). */
export function RemindDialog({ invoice, open, onClose }: { invoice: InvoiceDetail; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('invoices');
  const { email: customerEmail, loading } = useCustomerEmail(invoice.customer.id, open);
  const schema = useMemo(() => emailSchema(t('validation.email')), [t]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<EmailForm>({ resolver: zodResolver(schema), defaultValues: { email: '' } });

  useEffect(() => {
    if (open && !isDirty) reset({ email: customerEmail ?? invoice.emailedTo ?? '' });
  }, [open, isDirty, customerEmail, invoice.emailedTo, reset]);
  useEffect(() => {
    if (!open) reset({ email: '' });
  }, [open, reset]);

  const remind = useMutation({
    mutationFn: (email: string) =>
      api.post<{ ok: boolean; to: string }>(`/invoices/${invoice.id}/remind`, { email: email || undefined }),
    onSuccess: (res) => {
      toast.success(t('remind.done', { email: res.to }));
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });
  const onSubmit = handleSubmit((values) => remind.mutate(values.email.trim()));

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => void onSubmit()}
      title={t('remind.title', { number: invoice.numberFormatted })}
      message={t('remind.explain', { amount: fmtEUR(remainingCents(invoice)) })}
      confirmLabel={t('remind.confirm')}
      destructive={false}
      busy={remind.isPending || loading}
    >
      <form
        className="mt-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Field label={t('send.email')} error={errors.email?.message} hint={t('remind.emailHint')}>
          <Input type="email" autoComplete="off" aria-label={t('send.email')} {...register('email')} />
        </Field>
      </form>
    </ConfirmDialog>
  );
}

// ---------------------------------------------------------------- payment

type PaymentForm = { date: string; amount: string; methodId: string; receivedById: string; reference: string };

/** Record a received payment; "Amount received by" is required exactly like the API. */
export function PaymentDialog({ invoice, open, onClose }: { invoice: InvoiceDetail; open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation('invoices');
  const refresh = useInvoiceRefresh();
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
  const remaining = remainingCents(invoice);

  const schema = useMemo(
    () =>
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.date')),
        amount: z.string().refine((v) => {
          const cents = euroInputToCents(v);
          return cents !== null && cents > 0;
        }, t('validation.amount')),
        methodId: z.string(),
        receivedById: z.string().min(1, t('validation.receivedBy')),
        reference: z.string().max(70, t('validation.tooLong', { max: 70 })),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<PaymentForm>({
    resolver: zodResolver(schema),
    defaultValues: { date: todayInHelsinki(), amount: '', methodId: '', receivedById: '', reference: '' },
  });

  // fresh form each time the dialog opens; the amount defaults to what is still open
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      reset({
        date: todayInHelsinki(),
        amount: centsToInput(remaining),
        methodId: '',
        receivedById: '',
        reference: '',
      });
    }
    wasOpen.current = open;
  }, [open, remaining, reset]);

  const pay = useMutation({
    mutationFn: (values: PaymentForm) =>
      api.post<{ invoice: InvoiceDetail }>(`/invoices/${invoice.id}/payments`, {
        date: values.date,
        amountCents: euroInputToCents(values.amount),
        methodId: values.methodId ? Number(values.methodId) : null,
        receivedById: Number(values.receivedById),
        reference: values.reference.trim() || null,
      }),
    onSuccess: (res) => {
      refresh(res.invoice);
      toast.success(
        res.invoice.status === 'PAID'
          ? t('payment.doneFull')
          : t('payment.donePartial', { amount: fmtEUR(remainingCents(res.invoice)) }),
      );
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onSubmit = handleSubmit((values) => pay.mutate(values));
  const typedCents = euroInputToCents(watch('amount') ?? '');
  const overpay = typedCents !== null && typedCents > remaining && remaining > 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('payment.title', { number: invoice.numberFormatted })}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={pay.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button onClick={() => void onSubmit()} disabled={pay.isPending}>
            {t('payment.submit')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <dl className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-3 text-center">
          <div>
            <dt className="text-2xs text-muted-foreground">{t('totals.gross')}</dt>
            <dd className="text-sm font-semibold tabular-nums">{fmtEUR(invoice.totalGrossCents - creditedCents(invoice))}</dd>
          </div>
          <div>
            <dt className="text-2xs text-muted-foreground">{t('detail.paid')}</dt>
            <dd className="text-sm font-semibold tabular-nums text-profit">{fmtEUR(invoice.paidCents)}</dd>
          </div>
          <div>
            <dt className="text-2xs text-muted-foreground">{t('detail.remaining')}</dt>
            <dd className="text-sm font-semibold tabular-nums text-loss">{fmtEUR(remaining)}</dd>
          </div>
        </dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common:common.date')} error={errors.date?.message} required>
            <Input type="date" aria-label={t('common:common.date')} {...register('date')} />
          </Field>
          <Field
            label={t('common:common.amount')}
            error={errors.amount?.message}
            hint={overpay ? t('payment.overpay') : undefined}
            required
          >
            <Input inputMode="decimal" aria-label={t('common:common.amount')} {...register('amount')} />
          </Field>
          <Field label={t('common:money.paymentMethod')}>
            <Select aria-label={t('common:money.paymentMethod')} {...register('methodId')}>
              <option value="">{t('common:common.none')}</option>
              {(lookups.data?.methods ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {i18n.language === 'fi' ? (m.nameFi ?? m.name) : m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:money.receivedBy')} error={errors.receivedById?.message} required>
            <Select aria-label={t('common:money.receivedBy')} aria-required {...register('receivedById')}>
              <option value="">{t('payment.chooseReceiver')}</option>
              {(lookups.data?.holders ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label={t('payment.reference')}
            error={errors.reference?.message}
            hint={t('payment.referenceHint')}
            className="sm:col-span-2"
          >
            <Input maxLength={70} aria-label={t('payment.reference')} {...register('reference')} />
          </Field>
        </div>
        {lookups.isError ? <p className="text-2xs text-destructive">{t('payment.lookupsFailed')}</p> : null}
      </form>
    </Dialog>
  );
}
