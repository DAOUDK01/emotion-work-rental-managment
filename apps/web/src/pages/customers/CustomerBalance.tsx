import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';

interface ModelRef {
  id: number;
  code: string;
  nameEn: string;
  nameFi: string;
}

interface OpenItem {
  entryId: number;
  date: string;
  model: ModelRef | null;
  description: string | null;
  unitCode: string | null;
  grossCents: number;
  receivedCents: number;
  owedCents: number;
  invoice: { id: number; numberFormatted: string } | null;
  payable: boolean;
}

interface BalanceResponse {
  byModel: Array<{
    model: ModelRef;
    chargedCents: number;
    receivedCents: number;
    owedCents: number;
    items: number;
  }>;
  openItems: OpenItem[];
  totals: { chargedCents: number; receivedCents: number; owedCents: number };
}

interface PaymentLookups {
  holders: Array<{ id: number; name: string }>;
  methods: Array<{ id: number; name: string; nameFi?: string | null }>;
}

const modelName = (m: ModelRef | null, lang: string) =>
  m ? (lang === 'fi' ? m.nameFi : m.nameEn) : '–';

/**
 * The per-customer dropdown on the Customers list: money by type (Rental, Repair &
 * maintenance, Spare parts, Miscellaneous, …) — charged / paid / still owed — and the
 * open items, each with "Record payment" for part (or all) of what is still owed.
 */
export function CustomerBalance({
  customerId,
  canWrite,
}: {
  customerId: number;
  canWrite: boolean;
}) {
  const { t, i18n } = useTranslation('customers');
  const [paying, setPaying] = useState<OpenItem | null>(null);

  const balance = useQuery({
    queryKey: ['customers', 'balance', customerId],
    queryFn: () => api.get<BalanceResponse>(`/customers/${customerId}/balance`),
  });

  if (balance.isLoading) return <LoadingState />;
  if (balance.isError)
    return <ErrorState error={balance.error} onRetry={() => void balance.refetch()} />;
  const data = balance.data!;

  return (
    <div className="space-y-3 py-1">
      <Table>
        <THead>
          <TR>
            <TH>{t('balance.type')}</TH>
            <TH className="text-right">{t('balance.charged')}</TH>
            <TH className="text-right">{t('balance.paid')}</TH>
            <TH className="text-right">{t('balance.owed')}</TH>
          </TR>
        </THead>
        <TBody>
          {data.byModel.map((b) => (
            <TR key={b.model.id}>
              <TD className="font-medium">{modelName(b.model, i18n.language)}</TD>
              <TDMoney>{fmtEUR(b.chargedCents)}</TDMoney>
              <TDMoney>{fmtEUR(b.receivedCents)}</TDMoney>
              <TDMoney className={b.owedCents > 0 ? 'font-semibold text-loss' : undefined}>
                {fmtEUR(b.owedCents)}
              </TDMoney>
            </TR>
          ))}
        </TBody>
        <TFoot>
          <TR>
            <TD>{t('common:common.total')}</TD>
            <TDMoney>{fmtEUR(data.totals.chargedCents)}</TDMoney>
            <TDMoney>{fmtEUR(data.totals.receivedCents)}</TDMoney>
            <TDMoney className={data.totals.owedCents > 0 ? 'font-semibold text-loss' : undefined}>
              {fmtEUR(data.totals.owedCents)}
            </TDMoney>
          </TR>
        </TFoot>
      </Table>

      <div>
        <p className="mb-1 text-xs font-semibold text-muted-foreground">{t('balance.openItems')}</p>
        {data.openItems.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('balance.nothingOwed')}</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('common:common.date')}</TH>
                <TH>{t('balance.type')}</TH>
                <TH>{t('balance.what')}</TH>
                <TH className="text-right">{t('balance.total')}</TH>
                <TH className="text-right">{t('balance.paid')}</TH>
                <TH className="text-right">{t('balance.owed')}</TH>
                {canWrite ? <TH /> : null}
              </TR>
            </THead>
            <TBody>
              {data.openItems.map((item) => (
                <TR key={item.entryId}>
                  <TD className="whitespace-nowrap">{fmtDate(item.date)}</TD>
                  <TD>{modelName(item.model, i18n.language)}</TD>
                  <TD className="max-w-[16rem]">
                    <span className="block truncate">
                      {item.invoice
                        ? `${t('balance.invoice')} ${item.invoice.numberFormatted}`
                        : null}
                      {item.invoice && (item.description || item.unitCode) ? ' · ' : null}
                      {[item.unitCode, item.description].filter(Boolean).join(' · ') ||
                        (item.invoice ? '' : '–')}
                    </span>
                  </TD>
                  <TDMoney>{fmtEUR(item.grossCents)}</TDMoney>
                  <TDMoney>{fmtEUR(item.receivedCents)}</TDMoney>
                  <TDMoney className="font-semibold text-loss">{fmtEUR(item.owedCents)}</TDMoney>
                  {canWrite ? (
                    <TD className="text-right">
                      {item.payable ? (
                        <Button size="sm" variant="outline" onClick={() => setPaying(item)}>
                          {t('balance.recordPayment')}
                        </Button>
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </div>

      <RecordPaymentDialog item={paying} customerId={customerId} onClose={() => setPaying(null)} />
    </div>
  );
}

/** Part (or all) of what is still owed: an invoice takes it on the invoice, any other item on its entry. */
function RecordPaymentDialog({
  item,
  customerId,
  onClose,
}: {
  item: OpenItem | null;
  customerId: number;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('customers');
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState('');
  const [receivedById, setReceivedById] = useState('');
  const [methodId, setMethodId] = useState('');
  const [date, setDate] = useState(todayInHelsinki());
  const [error, setError] = useState<string | null>(null);

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<PaymentLookups>('/lookups'),
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (item) {
      setAmount(centsToInput(item.owedCents));
      setReceivedById('');
      setMethodId('');
      setDate(todayInHelsinki());
      setError(null);
    }
  }, [item]);

  const pay = useMutation({
    mutationFn: (body: {
      amountCents: number;
      receivedById: number;
      methodId: number | null;
      date: string;
    }) =>
      item!.invoice
        ? api.post(`/invoices/${item!.invoice.id}/payments`, body)
        : api.post(`/entries/${item!.entryId}/payments`, {
            amountCents: body.amountCents,
            receivedById: body.receivedById,
            paymentMethodId: body.methodId,
            date: body.date,
          }),
    onSuccess: () => {
      toast.success(t('balance.paymentSaved'));
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['customers', 'balance', customerId] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['cash'] });
      void queryClient.invalidateQueries({ queryKey: ['entries'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['rentals'] });
      onClose();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : t('common:common.errorTitle')),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!item) return;
    const cents = euroInputToCents(amount);
    if (cents === null || cents <= 0) return setError(t('balance.amountInvalid'));
    if (cents > item.owedCents)
      return setError(t('balance.amountTooHigh', { owed: fmtEUR(item.owedCents) }));
    if (!receivedById) return setError(t('balance.receivedByRequired'));
    setError(null);
    pay.mutate({
      amountCents: cents,
      receivedById: Number(receivedById),
      methodId: methodId ? Number(methodId) : null,
      date,
    });
  };

  return (
    <Dialog
      open={item !== null}
      onClose={pay.isPending ? () => undefined : onClose}
      title={t('balance.recordPayment')}
    >
      {item ? (
        <form onSubmit={submit} className="space-y-3" noValidate>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-3 text-sm">
            <dt className="text-muted-foreground">{t('balance.type')}</dt>
            <dd className="font-medium">{modelName(item.model, i18n.language)}</dd>
            <dt className="text-muted-foreground">{t('balance.total')}</dt>
            <dd className="tabular-nums">{fmtEUR(item.grossCents)}</dd>
            <dt className="text-muted-foreground">{t('balance.paid')}</dt>
            <dd className="tabular-nums">{fmtEUR(item.receivedCents)}</dd>
            <dt className="text-muted-foreground">{t('balance.owed')}</dt>
            <dd className="font-semibold tabular-nums text-loss">{fmtEUR(item.owedCents)}</dd>
          </dl>
          <Field label={t('balance.amountNow')} required hint={t('balance.amountHint')}>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label={t('common:money.receivedBy')} required>
            <Select value={receivedById} onChange={(e) => setReceivedById(e.target.value)}>
              <option value="">{t('balance.selectReceiver')}</option>
              {(lookups.data?.holders ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:money.paymentMethod')}>
            <Select value={methodId} onChange={(e) => setMethodId(e.target.value)}>
              <option value="">{t('common:common.none')}</option>
              {(lookups.data?.methods ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {i18n.language === 'fi' && m.nameFi ? m.nameFi : m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:common.date')} required>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          {error ? (
            <p className="text-xs font-medium text-loss" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={onClose} disabled={pay.isPending}>
              {t('common:action.cancel')}
            </Button>
            <Button type="submit" disabled={pay.isPending}>
              {t('balance.save')}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}
