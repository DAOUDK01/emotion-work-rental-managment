import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Download, Plus, Search, Trash2, Undo2 } from 'lucide-react';
import { api, ApiError, downloadFile, qs } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtDate, fmtEUR, fmtNumber } from '@/lib/format';
import { cn } from '@/components/ui/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import {
  errMsg,
  methodName,
  normalizeReceiptNumber,
  parseQty,
  productName,
  todayIso,
  type Lookups,
  type RefundResponse,
  type Sale,
  type SaleListResponse,
  type SaleResponse,
} from './types';

// ---------------------------------------------------------------- refund form

interface RefundForm {
  lines: Array<{ selected: boolean; qty: string }>;
  reason: string;
  restock: boolean;
  payments: Array<{ methodId: string; receivedById: string; amount: string }>;
}

function RefundForm({
  sale,
  lookups,
  onDone,
}: {
  sale: Sale;
  lookups: Lookups | undefined;
  onDone: (result: RefundResponse) => void;
}) {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const methods = lookups?.methods ?? [];
  const holders = lookups?.holders ?? [];
  const [expectedOverride, setExpectedOverride] = useState<number | null>(null);

  const schema = useMemo(
    () =>
      z
        .object({
          lines: z.array(z.object({ selected: z.boolean(), qty: z.string() })),
          reason: z.string().trim().min(1, t('validation.reasonRequired')).max(500),
          restock: z.boolean(),
          payments: z
            .array(
              z.object({
                methodId: z.string(),
                receivedById: z.string().min(1, t('validation.receiverRequired')),
                amount: z.string().refine((v) => {
                  const c = euroInputToCents(v);
                  return c !== null && c > 0;
                }, t('validation.badAmount')),
              }),
            )
            .min(1),
        })
        .superRefine((v, ctx) => {
          v.lines.forEach((l, i) => {
            if (!l.selected) return;
            const q = parseQty(l.qty);
            const max = sale.lines[i]?.qty ?? 0;
            if (q === null || q > max) {
              ctx.addIssue({ code: 'custom', path: ['lines', i, 'qty'], message: t('refund.badQty', { max: fmtNumber(max) }) });
            }
          });
        }),
    [t, sale],
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<RefundForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      lines: sale.lines.map((l) => ({ selected: false, qty: String(l.qty) })),
      reason: '',
      restock: true,
      payments: [{ methodId: methods[0] ? String(methods[0].id) : '', receivedById: '', amount: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'payments' });

  const lineValues = watch('lines');
  const payments = watch('payments');
  const restock = watch('restock');

  const estimateCents = sale.lines.reduce((sum, line, i) => {
    const v = lineValues[i];
    if (!v?.selected) return sum;
    const q = parseQty(v.qty) ?? 0;
    return sum + (line.qty > 0 ? Math.round((line.effectiveGrossCents * Math.min(q, line.qty)) / line.qty) : 0);
  }, 0);
  const expectedCents = expectedOverride ?? estimateCents;
  const paidCents = payments.reduce((s, p) => s + (euroInputToCents(p.amount) ?? 0), 0);
  const anySelected = lineValues.some((l) => l.selected);

  useEffect(() => {
    setExpectedOverride(null);
  }, [estimateCents]);

  useEffect(() => {
    if (payments.length === 1) setValue('payments.0.amount', expectedCents > 0 ? centsToInput(expectedCents) : '');
    // Keep a single refund row in step with the selection.
  }, [expectedCents, payments.length, setValue]);

  const refund = useMutation({
    mutationFn: (body: {
      lines: Array<{ lineId: number; qty: number }>;
      reason: string;
      restock: boolean;
      refundPayments: Array<{ methodId: number | null; receivedById: number; amountCents: number }>;
    }) => api.post<RefundResponse>(`/pos/sales/${sale.id}/refund`, body),
    onSuccess: (res) => {
      toast.success(t('refund.done', { number: res.creditNote.numberFormatted }));
      void queryClient.invalidateQueries({ queryKey: ['pos'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['entries'] });
      onDone(res);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'PAYMENT_MISMATCH') {
        const d = err.details as { expectedCents?: unknown } | undefined;
        if (typeof d?.expectedCents === 'number') {
          setExpectedOverride(d.expectedCents);
          toast.error(t('refund.amountAdjusted', { amount: fmtEUR(d.expectedCents) }));
          return;
        }
      }
      toast.error(errMsg(err));
    },
  });

  const submit = handleSubmit((v) => {
    const lines = v.lines.flatMap((l, i) =>
      l.selected ? [{ lineId: sale.lines[i].id, qty: parseQty(l.qty) ?? 0 }] : [],
    );
    if (lines.length === 0) {
      toast.error(t('refund.selectLines'));
      return;
    }
    if (paidCents !== expectedCents) {
      toast.error(t('refund.paymentMismatch', { amount: fmtEUR(expectedCents) }));
      return;
    }
    refund.mutate({
      lines,
      reason: v.reason.trim(),
      restock: v.restock,
      refundPayments: v.payments.map((p) => ({
        methodId: p.methodId ? Number(p.methodId) : null,
        receivedById: Number(p.receivedById),
        amountCents: euroInputToCents(p.amount) ?? 0,
      })),
    });
  });

  return (
    <form id="pos-refund-form" onSubmit={submit} className="space-y-4" noValidate>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{sale.number}</span>
        <span className="text-muted-foreground">{fmtDate(sale.businessDate)}</span>
        {sale.customer ? <span>· {sale.customer.name}</span> : null}
        <span className="ml-auto font-semibold tabular-nums">{fmtEUR(sale.totalGrossCents)}</span>
      </div>
      {sale.refundedGrossCents > 0 ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
          {t('refund.alreadyRefunded', { amount: fmtEUR(sale.refundedGrossCents) })}
        </p>
      ) : null}

      <Table>
        <THead>
          <TR>
            <TH className="w-10">
              <span className="sr-only">{t('refund.select')}</span>
            </TH>
            <TH>{t('cart.item')}</TH>
            <TH className="text-right">{t('refund.sold')}</TH>
            <TH className="w-28">{t('refund.qty')}</TH>
            <TH className="text-right">{t('refund.paid')}</TH>
          </TR>
        </THead>
        <TBody>
          {sale.lines.map((line, i) => {
            const selected = lineValues[i]?.selected ?? false;
            const label = line.product ? productName(line.product, lang) : line.description;
            return (
              <TR key={line.id} className={cn(selected && 'bg-muted/40')}>
                <TD>
                  <Checkbox
                    aria-label={t('refund.selectLine', { name: label })}
                    checked={selected}
                    onChange={(e) => setValue(`lines.${i}.selected`, e.target.checked, { shouldValidate: false })}
                  />
                </TD>
                <TD className="font-medium">{label}</TD>
                <TD className="text-right tabular-nums">{fmtNumber(line.qty)}</TD>
                <TD>
                  <Input
                    className={cn('h-8', !selected && 'opacity-50')}
                    inputMode="decimal"
                    readOnly={!selected}
                    tabIndex={selected ? undefined : -1}
                    aria-label={t('refund.qty')}
                    {...register(`lines.${i}.qty`)}
                  />
                  {errors.lines?.[i]?.qty?.message ? (
                    <p className="mt-1 text-2xs font-medium text-destructive">{errors.lines[i]?.qty?.message}</p>
                  ) : null}
                </TD>
                <TDMoney>{fmtEUR(line.effectiveGrossCents)}</TDMoney>
              </TR>
            );
          })}
        </TBody>
      </Table>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('refund.reason')} error={errors.reason?.message} required className="sm:col-span-2">
          <Textarea rows={2} {...register('reason')} />
        </Field>
        <div className="sm:col-span-2">
          <Checkbox
            label={t('refund.restock')}
            checked={restock}
            onChange={(e) => setValue('restock', e.target.checked)}
          />
          <p className="pl-6 text-2xs text-muted-foreground">{t('refund.restockHint')}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{t('refund.payments')}</p>
          <p className="text-sm">
            {t('refund.toRefund')}: <span className="font-bold tabular-nums">{fmtEUR(expectedCents)}</span>
          </p>
        </div>
        {fields.map((field, i) => (
          <div key={field.id} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
            <Field label={t('common:money.paymentMethod')}>
              <Select {...register(`payments.${i}.methodId`)}>
                <option value="">{t('payment.noMethod')}</option>
                {methods.map((m) => (
                  <option key={m.id} value={m.id}>
                    {methodName(m, lang)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('refund.paidBackBy')} error={errors.payments?.[i]?.receivedById?.message} required>
              <Select {...register(`payments.${i}.receivedById`)}>
                <option value="">{t('payment.chooseReceiver')}</option>
                {holders.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('common:common.amount')} error={errors.payments?.[i]?.amount?.message} required>
              <Input inputMode="decimal" {...register(`payments.${i}.amount`)} />
            </Field>
            <div className="flex items-end">
              {fields.length > 1 ? (
                <Button variant="ghost" size="icon" onClick={() => remove(i)} aria-label={t('payment.removeSplit')}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={fields.length >= 10}
            onClick={() =>
              append({
                methodId: methods[0] ? String(methods[0].id) : '',
                receivedById: payments[0]?.receivedById ?? '',
                amount: centsToInput(Math.max(0, expectedCents - paidCents)),
              })
            }
          >
            <Plus className="h-3.5 w-3.5" /> {t('payment.addSplit')}
          </Button>
          {anySelected && paidCents !== expectedCents ? (
            <p className="text-xs font-semibold text-loss">
              {t('refund.paymentMismatch', { amount: fmtEUR(expectedCents) })}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" variant="destructive" size="pos" disabled={refund.isPending || !anySelected}>
          <Undo2 className="h-5 w-5" /> {t('refund.submit', { amount: fmtEUR(expectedCents) })}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- find receipt + refund

/** "Find receipt" → pick a completed sale → refund selected lines (credit note). */
export function RefundDialog({
  open,
  lookups,
  onClose,
}: {
  open: boolean;
  lookups: Lookups | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation('pos');
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayIso);
  const [receipt, setReceipt] = useState('');
  const [finding, setFinding] = useState(false);
  const [notFound, setNotFound] = useState<string | null>(null);
  const [saleId, setSaleId] = useState<number | null>(null);
  const [result, setResult] = useState<RefundResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayIso());
    setReceipt('');
    setNotFound(null);
    setSaleId(null);
    setResult(null);
  }, [open]);

  const sales = useQuery({
    queryKey: ['pos', 'sales', 'COMPLETED', date],
    queryFn: () => api.get<SaleListResponse>('/pos/sales' + qs({ status: 'COMPLETED', date, pageSize: 200 })),
    enabled: open && saleId === null && date !== '',
  });

  const detail = useQuery({
    queryKey: ['pos', 'sale', saleId],
    queryFn: () => api.get<SaleResponse>(`/pos/sales/${saleId}`),
    enabled: open && saleId !== null,
  });

  const findByNumber = async () => {
    const number = normalizeReceiptNumber(receipt);
    if (!number) return;
    setFinding(true);
    setNotFound(null);
    try {
      for (const status of ['COMPLETED', 'REFUNDED'] as const) {
        const list = await queryClient.fetchQuery({
          queryKey: ['pos', 'sales', status, 'all'],
          queryFn: () => api.get<SaleListResponse>('/pos/sales' + qs({ status, pageSize: 200 })),
          staleTime: 10_000,
        });
        const match = list.sales.find((s) => s.number === number);
        if (match) {
          setSaleId(match.id);
          return;
        }
      }
      setNotFound(t('refund.notFound', { number }));
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setFinding(false);
    }
  };

  const title = result ? t('refund.doneTitle') : saleId !== null ? t('refund.title') : t('refund.findTitle');

  return (
    <Dialog open={open} onClose={onClose} title={title} wide>
      {result ? (
        <div className="space-y-4 text-center">
          <Undo2 className="mx-auto h-10 w-10 text-profit" />
          <p className="text-sm">
            {t('refund.creditNote')} <span className="font-semibold">{result.creditNote.numberFormatted}</span> ·{' '}
            {result.creditNote.saleNumber}
          </p>
          <p className="text-3xl font-bold tabular-nums">{fmtEUR(result.creditNote.totalGrossCents)}</p>
          <p className="text-xs text-muted-foreground">
            {result.saleStatus === 'REFUNDED' ? t('refund.fullyRefunded') : t('refund.partiallyRefunded')}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="pos"
              onClick={() =>
                void downloadFile(
                  result.receiptPdfUrl.replace(/^\/api/, ''),
                  `receipt-${result.creditNote.saleNumber}.pdf`,
                ).catch((err: unknown) => toast.error(errMsg(err)))
              }
            >
              <Download className="h-5 w-5" /> {t('success.a4Pdf')}
            </Button>
            <Button size="pos" onClick={onClose} autoFocus>
              {t('common:action.close')}
            </Button>
          </div>
        </div>
      ) : saleId !== null ? (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={() => setSaleId(null)}>
            <ArrowLeft className="h-4 w-4" /> {t('refund.backToList')}
          </Button>
          {detail.isLoading ? <LoadingState label={t('common:common.loading')} /> : null}
          {detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : null}
          {detail.data ? (
            detail.data.sale.status === 'COMPLETED' ? (
              <RefundForm key={detail.data.sale.id} sale={detail.data.sale} lookups={lookups} onDone={setResult} />
            ) : (
              <EmptyState
                title={t('refund.notRefundable', { number: detail.data.sale.number })}
                hint={
                  detail.data.sale.status === 'REFUNDED' ? t('refund.fullyRefunded') : t('refund.notRefundableHint')
                }
              />
            )
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void findByNumber();
            }}
          >
            <Field label={t('refund.receiptNumber')} className="min-w-[12rem] flex-1">
              <Input
                value={receipt}
                onChange={(e) => setReceipt(e.target.value)}
                placeholder="R-000123"
                autoFocus
              />
            </Field>
            <Button type="submit" disabled={finding || receipt.trim() === ''}>
              <Search className="h-4 w-4" /> {t('refund.find')}
            </Button>
          </form>
          {notFound ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive" role="alert">
              {notFound}
            </p>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-2 border-t pt-3">
            <p className="text-sm font-semibold">{t('refund.salesOfDay')}</p>
            <Field label={t('common:common.date')}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </Field>
          </div>
          {sales.isLoading ? <LoadingState label={t('common:common.loading')} /> : null}
          {sales.isError ? <ErrorState error={sales.error} onRetry={() => void sales.refetch()} /> : null}
          {sales.isSuccess && sales.data.sales.length === 0 ? (
            <EmptyState title={t('refund.noSales')} hint={t('refund.noSalesHint')} />
          ) : null}
          {sales.data && sales.data.sales.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>{t('refund.receipt')}</TH>
                  <TH>{t('details.customer')}</TH>
                  <TH className="text-right">{t('refund.lines')}</TH>
                  <TH className="text-right">{t('common:common.total')}</TH>
                  <TH>
                    <span className="sr-only">{t('common:common.actions')}</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {sales.data.sales.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium">
                      {s.number}
                      <span className="ml-2 text-2xs text-muted-foreground">
                        {new Date(s.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </TD>
                    <TD>{s.customer?.name ?? <Badge variant="outline">{t('cart.walkIn')}</Badge>}</TD>
                    <TD className="text-right tabular-nums">{s.lineCount}</TD>
                    <TDMoney>{fmtEUR(s.totalGrossCents)}</TDMoney>
                    <TD className="text-right">
                      <Button size="sm" variant="outline" onClick={() => setSaleId(s.id)}>
                        {t('refund.open')}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}
