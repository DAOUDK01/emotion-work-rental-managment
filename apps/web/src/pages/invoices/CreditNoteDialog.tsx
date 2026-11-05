import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Textarea } from '@/components/ui/input';
import { Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { errorMessage, useInvoiceRefresh } from './InvoiceDialogs';
import { parseQty, type InvoiceCreditNote, type InvoiceDetail } from './types';

type CreditForm = { reason: string; restock: boolean };
type LinePick = { checked: boolean; qty: string };
type CreditBody = { reason: string; restock: boolean; lines?: Array<{ lineId: number; qty: number }> };

/**
 * Credit note: full (invoice → CANCELLED, entry voided) or selected lines/quantities
 * (reversing entry). The form leads to a final ConfirmDialog — credit notes are permanent.
 */
export function CreditNoteDialog({ invoice, open, onClose }: { invoice: InvoiceDetail; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('invoices');
  const refresh = useInvoiceRefresh();
  const queryClient = useQueryClient();
  const hasPrevious = invoice.creditNotes.length > 0;
  const hasProducts = invoice.lines.some((l) => l.productId !== null);
  const [mode, setMode] = useState<'full' | 'partial'>(hasPrevious ? 'partial' : 'full');
  const [picks, setPicks] = useState<Record<number, LinePick>>({});
  const [linesError, setLinesError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ body: CreditBody; amountCents: number } | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        reason: z.string().trim().min(1, t('validation.reasonRequired')).max(500, t('validation.tooLong', { max: 500 })),
        restock: z.boolean(),
      }),
    [t],
  );
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<CreditForm>({ resolver: zodResolver(schema), defaultValues: { reason: '', restock: false } });

  // fresh form each time the dialog opens (not on background refetches while it is open)
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      reset({ reason: '', restock: false });
      setMode(hasPrevious ? 'partial' : 'full');
      setPicks(Object.fromEntries(invoice.lines.map((l) => [l.id, { checked: false, qty: String(l.qty) }])));
      setLinesError(null);
      setPending(null);
    }
    wasOpen.current = open;
  }, [open, hasPrevious, invoice.lines, reset]);

  /** Display estimate only — the API computes the exact per-line split. */
  const partialEstimate = invoice.lines.reduce((sum, l) => {
    const pick = picks[l.id];
    const qty = pick?.checked ? parseQty(pick.qty) : null;
    if (!qty || l.qty <= 0) return sum;
    return sum + Math.round((l.lineGrossCents * Math.min(qty, l.qty)) / l.qty);
  }, 0);

  const credit = useMutation({
    mutationFn: (body: CreditBody) =>
      api.post<{ creditNote: InvoiceCreditNote; invoice: InvoiceDetail }>(`/invoices/${invoice.id}/credit-note`, body),
    onSuccess: (res) => {
      refresh(res.invoice);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      toast.success(
        res.invoice.status === 'CANCELLED'
          ? t('credit.doneCancelled', { number: res.creditNote.numberFormatted })
          : t('credit.done', { number: res.creditNote.numberFormatted, amount: fmtEUR(res.creditNote.totalGrossCents) }),
      );
      setPending(null);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onSubmit = handleSubmit((values) => {
    const base: CreditBody = { reason: values.reason.trim(), restock: hasProducts ? values.restock : false };
    if (mode === 'full') {
      setPending({ body: base, amountCents: invoice.totalGrossCents });
      return;
    }
    const selected: Array<{ lineId: number; qty: number }> = [];
    for (const line of invoice.lines) {
      const pick = picks[line.id];
      if (!pick?.checked) continue;
      const qty = parseQty(pick.qty);
      if (qty === null || qty > line.qty) {
        setLinesError(t('credit.badQty', { description: line.description, max: line.qty }));
        return;
      }
      selected.push({ lineId: line.id, qty });
    }
    if (selected.length === 0) {
      setLinesError(t('credit.pickLines'));
      return;
    }
    setLinesError(null);
    setPending({ body: { ...base, lines: selected }, amountCents: partialEstimate });
  });

  return (
    <>
      <Dialog
        open={open && pending === null}
        onClose={onClose}
        wide
        title={t('credit.title', { number: invoice.numberFormatted })}
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              {t('common:action.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void onSubmit()}>
              {t('credit.review')}
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
          <Segmented
            size="sm"
            value={mode}
            onChange={(m) => {
              if (m === 'full' && hasPrevious) return;
              setMode(m);
            }}
            options={[
              { value: 'full' as const, label: t('credit.full') },
              { value: 'partial' as const, label: t('credit.partial') },
            ]}
          />
          {hasPrevious ? <p className="text-2xs text-muted-foreground">{t('credit.fullBlocked')}</p> : null}

          {mode === 'full' ? (
            <p className="rounded-md border border-loss/30 bg-loss/5 px-3 py-2 text-xs">
              {t('credit.fullExplain', { amount: fmtEUR(invoice.totalGrossCents) })}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{t('credit.partialExplain')}</p>
              <Table className="min-w-[520px]">
                <THead>
                  <TR>
                    <TH className="w-10">
                      <span className="sr-only">{t('credit.select')}</span>
                    </TH>
                    <TH>{t('lines.description')}</TH>
                    <TH className="w-20 text-right">{t('credit.invoicedQty')}</TH>
                    <TH className="w-28">{t('credit.creditQty')}</TH>
                    <TH className="w-28 text-right">{t('lines.lineTotal')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoice.lines.map((line) => {
                    const pick = picks[line.id] ?? { checked: false, qty: String(line.qty) };
                    return (
                      <TR key={line.id}>
                        <TD>
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[hsl(var(--primary))]"
                            aria-label={t('credit.selectLine', { description: line.description })}
                            checked={pick.checked}
                            onChange={(e) => setPicks((p) => ({ ...p, [line.id]: { ...pick, checked: e.target.checked } }))}
                          />
                        </TD>
                        <TD className="text-sm">{line.description}</TD>
                        <TD className="text-right tabular-nums">{line.qty}</TD>
                        <TD>
                          <Input
                            className="h-8"
                            inputMode="decimal"
                            aria-label={t('credit.creditQtyFor', { description: line.description })}
                            disabled={!pick.checked}
                            value={pick.qty}
                            onChange={(e) => setPicks((p) => ({ ...p, [line.id]: { ...pick, qty: e.target.value } }))}
                          />
                        </TD>
                        <TDMoney>{fmtEUR(line.lineGrossCents)}</TDMoney>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
              {linesError ? <p className="text-2xs font-medium text-destructive">{linesError}</p> : null}
              <p className="text-right text-sm">
                {t('credit.estimate')}: <span className="font-semibold tabular-nums">{fmtEUR(partialEstimate)}</span>
              </p>
            </div>
          )}

          <Field label={t('credit.reason')} error={errors.reason?.message} required>
            <Textarea maxLength={500} {...register('reason')} />
          </Field>
          {hasProducts ? (
            <div className="space-y-1">
              <Checkbox
                label={t('credit.restock')}
                checked={watch('restock')}
                onChange={(e) => setValue('restock', e.target.checked)}
              />
              <p className="text-2xs text-muted-foreground">{t('credit.restockHint')}</p>
            </div>
          ) : null}
        </form>
      </Dialog>

      <ConfirmDialog
        open={open && pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => {
          if (pending) credit.mutate(pending.body);
        }}
        title={t('credit.confirmTitle')}
        message={
          mode === 'full'
            ? t('credit.confirmFull', { number: invoice.numberFormatted, amount: fmtEUR(pending?.amountCents ?? 0) })
            : t('credit.confirmPartial', { number: invoice.numberFormatted, amount: fmtEUR(pending?.amountCents ?? 0) })
        }
        confirmLabel={t('credit.confirm')}
        busy={credit.isPending}
      />
    </>
  );
}
