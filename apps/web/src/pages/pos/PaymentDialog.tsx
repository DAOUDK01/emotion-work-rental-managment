import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PackageX, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtEUR } from '@/lib/format';
import { cn } from '@/components/ui/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import {
  errMsg,
  isCashMethod,
  methodName,
  outOfStockProducts,
  type CompleteSaleResponse,
  type Lookups,
  type OutOfStockProduct,
  type PaymentSplitBody,
  type Sale,
} from './types';

const LAST_RECEIVER_KEY = 'emf.pos.lastReceiver';
const LAST_METHOD_KEY = 'emf.pos.lastMethod';

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage may be unavailable */
  }
}

interface PayRow {
  methodId: string;
  receivedById: string;
  amount: string;
  tendered: string;
}

interface PayForm {
  rows: PayRow[];
  overrideVat: boolean;
  vatInvoice: boolean;
}

interface CompleteBody {
  payments: PaymentSplitBody[];
  vatInvoice?: boolean;
  force?: boolean;
}

/** PAY: split payments (method + REQUIRED receiver + amount), cash change, VAT-invoice override. */
export function PaymentDialog({
  open,
  sale,
  lookups,
  onClose,
  onCompleted,
}: {
  open: boolean;
  sale: Sale | undefined;
  lookups: Lookups | undefined;
  onClose: () => void;
  onCompleted: (sale: Sale, changeCents: number) => void;
}) {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const totalCents = sale?.totalGrossCents ?? 0;
  const methods = lookups?.methods ?? [];
  const holders = lookups?.holders ?? [];
  const [outOfStock, setOutOfStock] = useState<OutOfStockProduct[] | null>(null);
  const [lastBody, setLastBody] = useState<CompleteBody | null>(null);

  const isCash = (methodId: string) => {
    const m = methods.find((x) => String(x.id) === methodId);
    return m ? isCashMethod(m) : false;
  };

  const schema = useMemo(
    () =>
      z
        .object({
          rows: z
            .array(
              z.object({
                methodId: z.string(),
                receivedById: z.string().min(1, t('validation.receiverRequired')),
                amount: z
                  .string()
                  .trim()
                  .min(1, t('validation.amountRequired'))
                  .refine((v) => {
                    const c = euroInputToCents(v);
                    return c !== null && c > 0;
                  }, t('validation.badAmount')),
                tendered: z.string().trim(),
              }),
            )
            .min(1),
          overrideVat: z.boolean(),
          vatInvoice: z.boolean(),
        })
        .superRefine((v, ctx) => {
          v.rows.forEach((row, i) => {
            if (row.tendered === '') return;
            const tendered = euroInputToCents(row.tendered);
            const amount = euroInputToCents(row.amount) ?? 0;
            if (tendered === null || tendered < amount) {
              ctx.addIssue({ code: 'custom', path: ['rows', i, 'tendered'], message: t('payment.tenderedTooLow') });
            }
          });
        }),
    [t],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<PayForm>({
    resolver: zodResolver(schema),
    defaultValues: { rows: [], overrideVat: false, vatInvoice: true },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'rows' });

  const defaultMethodId = useMemo(() => {
    const stored = readStored(LAST_METHOD_KEY);
    if (stored && methods.some((m) => String(m.id) === stored)) return stored;
    return methods[0] ? String(methods[0].id) : '';
  }, [methods]);
  const defaultReceiverId = useMemo(() => {
    const stored = readStored(LAST_RECEIVER_KEY);
    return stored && holders.some((h) => String(h.id) === stored) ? stored : '';
  }, [holders]);

  useEffect(() => {
    if (!open) return;
    setOutOfStock(null);
    setLastBody(null);
    reset({
      rows: [{ methodId: defaultMethodId, receivedById: defaultReceiverId, amount: centsToInput(totalCents), tendered: '' }],
      overrideVat: false,
      vatInvoice: true,
    });
    // Reset only when the dialog opens (or the total changes underneath it).
  }, [open, totalCents]); // defaults are read once per opening on purpose

  const rows = watch('rows');
  const overrideVat = watch('overrideVat');
  const vatInvoice = watch('vatInvoice');
  const appliedCents = rows.reduce((s, r) => s + (euroInputToCents(r.amount) ?? 0), 0);
  const remainingCents = totalCents - appliedCents;
  const changeFor = (row: PayRow) => {
    if (!isCash(row.methodId) || row.tendered.trim() === '') return 0;
    const tendered = euroInputToCents(row.tendered) ?? 0;
    return Math.max(0, tendered - (euroInputToCents(row.amount) ?? 0));
  };

  // "VAT invoice issued?" default follows the first receiver (lookups.vatDefaults.byHolder), then the method.
  const firstReceiver = rows[0]?.receivedById ?? '';
  const firstMethod = rows[0]?.methodId ?? '';
  const vatDefault = useMemo(() => {
    const holder = holders.find((h) => String(h.id) === firstReceiver);
    const byHolder = holder ? lookups?.vatDefaults.byHolder[holder.name] : undefined;
    if (typeof byHolder === 'boolean') return byHolder;
    return methods.find((m) => String(m.id) === firstMethod)?.defaultVatInvoice ?? true;
  }, [holders, methods, lookups, firstReceiver, firstMethod]);
  useEffect(() => {
    setValue('vatInvoice', vatDefault);
  }, [vatDefault, setValue]);

  const complete = useMutation({
    mutationFn: (body: CompleteBody) => {
      if (!sale) throw new Error(t('errors.noSale'));
      return api.post<CompleteSaleResponse>(`/pos/sales/${sale.id}/complete`, body);
    },
    onSuccess: (res, body) => {
      toast.success(t('payment.completed', { number: res.sale.number }));
      onCompleted(
        res.sale,
        body.payments.reduce((s, p) => s + (p.changeCents ?? 0), 0),
      );
    },
    onError: (err) => {
      const oos = outOfStockProducts(err);
      if (oos) {
        setOutOfStock(oos);
        toast.error(t('payment.outOfStock'));
      } else {
        toast.error(errMsg(err));
      }
    },
  });

  const submit = handleSubmit((v) => {
    if (remainingCents !== 0) {
      toast.error(t('payment.mismatch', { remaining: fmtEUR(remainingCents) }));
      return;
    }
    const payments: PaymentSplitBody[] = v.rows.map((row) => {
      const amountCents = euroInputToCents(row.amount) ?? 0;
      const methodId = row.methodId ? Number(row.methodId) : null;
      const receivedById = Number(row.receivedById);
      const change = changeFor(row);
      return change > 0
        ? { methodId, receivedById, amountCents: amountCents + change, changeCents: change }
        : { methodId, receivedById, amountCents };
    });
    const body: CompleteBody = { payments, ...(v.overrideVat ? { vatInvoice: v.vatInvoice } : {}) };
    writeStored(LAST_RECEIVER_KEY, v.rows[0].receivedById);
    if (v.rows[0].methodId) writeStored(LAST_METHOD_KEY, v.rows[0].methodId);
    setOutOfStock(null);
    setLastBody(body);
    complete.mutate(body);
  });

  const addSplit = () =>
    append({
      methodId: defaultMethodId,
      receivedById: rows[0]?.receivedById ?? '',
      amount: centsToInput(Math.max(0, remainingCents)),
      tendered: '',
    });

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!complete.isPending) onClose();
      }}
      title={t('payment.title')}
      wide
      footer={
        <>
          <Button variant="outline" size="pos" onClick={onClose} disabled={complete.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button
            type="submit"
            form="pos-payment-form"
            size="pos"
            variant="accent"
            disabled={complete.isPending || remainingCents !== 0 || !sale}
          >
            {t('payment.confirm', { amount: fmtEUR(totalCents) })}
          </Button>
        </>
      }
    >
      <form id="pos-payment-form" onSubmit={submit} className="space-y-4" noValidate>
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/50 px-4 py-3">
          <span className="text-sm font-medium">{t('totals.total')}</span>
          <span className="text-3xl font-bold tabular-nums">{fmtEUR(totalCents)}</span>
        </div>

        <div className="space-y-3">
          {fields.map((field, i) => {
            const row = rows[i];
            const cash = row ? isCash(row.methodId) : false;
            const rowErrors = errors.rows?.[i];
            return (
              <div key={field.id} className="space-y-2 rounded-md border p-3">
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_9rem_auto]">
                  <Field label={t('common:money.paymentMethod')}>
                    <Select className="h-11" {...register(`rows.${i}.methodId`)}>
                      <option value="">{t('payment.noMethod')}</option>
                      {methods.map((m) => (
                        <option key={m.id} value={m.id}>
                          {methodName(m, lang)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('common:money.receivedBy')} error={rowErrors?.receivedById?.message} required>
                    <Select className="h-11" {...register(`rows.${i}.receivedById`)}>
                      <option value="">{t('payment.chooseReceiver')}</option>
                      {holders.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={t('common:common.amount')} error={rowErrors?.amount?.message} required>
                    <Input className="h-11 text-base tabular-nums" inputMode="decimal" {...register(`rows.${i}.amount`)} />
                  </Field>
                  <div className="flex items-end">
                    {fields.length > 1 ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-11 w-11"
                        onClick={() => remove(i)}
                        aria-label={t('payment.removeSplit')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                {cash && row ? (
                  <div className="grid gap-3 sm:grid-cols-[9rem_1fr_auto] sm:items-end">
                    <Field label={t('payment.tendered')} error={rowErrors?.tendered?.message}>
                      <Input className="h-11 text-base tabular-nums" inputMode="decimal" {...register(`rows.${i}.tendered`)} />
                    </Field>
                    <div className="flex flex-wrap gap-1.5">
                      {[2000, 5000, 10000].map((c) => (
                        <Button
                          key={c}
                          variant="outline"
                          size="sm"
                          className="h-11"
                          onClick={() => setValue(`rows.${i}.tendered`, centsToInput(c), { shouldValidate: true })}
                        >
                          {fmtEUR(c)}
                        </Button>
                      ))}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11"
                        onClick={() => setValue(`rows.${i}.tendered`, row.amount, { shouldValidate: true })}
                      >
                        {t('payment.exact')}
                      </Button>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">{t('payment.change')}</div>
                      <div className="text-2xl font-bold tabular-nums text-profit">{fmtEUR(changeFor(row))}</div>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" onClick={addSplit} disabled={fields.length >= 10}>
            <Plus className="h-4 w-4" /> {t('payment.addSplit')}
          </Button>
          <p
            className={cn('text-sm font-semibold tabular-nums', remainingCents === 0 ? 'text-profit' : 'text-loss')}
            aria-live="polite"
          >
            {remainingCents === 0
              ? t('payment.balanced')
              : remainingCents > 0
                ? t('payment.remaining', { amount: fmtEUR(remainingCents) })
                : t('payment.over', { amount: fmtEUR(-remainingCents) })}
          </p>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <Checkbox
            label={t('payment.overrideVat')}
            checked={overrideVat}
            onChange={(e) => setValue('overrideVat', e.target.checked)}
          />
          {overrideVat ? (
            <>
              <Checkbox
                label={t('common:money.vatInvoice')}
                checked={vatInvoice}
                onChange={(e) => setValue('vatInvoice', e.target.checked)}
              />
              {!vatInvoice ? (
                <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                  {t('common:money.vatWarning')}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-2xs text-muted-foreground">
              {t('payment.vatDefault', { value: vatDefault ? t('common:common.yes') : t('common:common.no') })}
            </p>
          )}
        </div>

        {outOfStock ? (
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3" role="alert">
            <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
              <PackageX className="h-4 w-4" /> {t('payment.outOfStock')}
            </p>
            <ul className="space-y-1 text-sm">
              {outOfStock.map((p) => (
                <li key={p.productId} className="flex justify-between gap-2">
                  <span>
                    {p.nameEn} <span className="text-xs text-muted-foreground">({p.sku})</span>
                  </span>
                  <span className="tabular-nums">
                    {t('payment.stockNeedHave', { need: p.requestedQty, have: p.availableQty })}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              variant="destructive"
              disabled={complete.isPending || !lastBody}
              onClick={() => {
                if (lastBody) complete.mutate({ ...lastBody, force: true });
              }}
            >
              {t('payment.sellAnyway')}
            </Button>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
