import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, ApiError, qs } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import {
  errorMessage,
  monthOf,
  previousMonth,
  type Contract,
  type CreatedInvoice,
  type JobListResponse,
} from './types';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const PAGE = 200;

/**
 * Bill one month of a contract: POST /contracts/:id/invoice-month creates ONE draft invoice
 * with a line per uninvoiced job of that month. 409 NO_JOBS is explained inline.
 */
export function InvoiceMonthDialog({
  open,
  contract,
  onClose,
}: {
  open: boolean;
  contract: Contract;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('contracts');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [month, setMonth] = useState('');
  const [noJobs, setNoJobs] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const uninvoiced = useQuery({
    queryKey: ['contracts', contract.id, 'jobs', 'uninvoiced-all'],
    queryFn: () =>
      api.get<JobListResponse>(`/contracts/${contract.id}/jobs` + qs({ invoiced: 'false', pageSize: PAGE })),
    enabled: open,
  });

  /** uninvoiced jobs grouped per month, oldest first */
  const months = useMemo(() => {
    const map = new Map<string, { count: number; cents: number }>();
    for (const job of uninvoiced.data?.jobs ?? []) {
      const key = monthOf(job.date);
      const cur = map.get(key) ?? { count: 0, cents: 0 };
      map.set(key, { count: cur.count + 1, cents: cur.cents + job.amountCents });
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => ({ key, ...v }));
  }, [uninvoiced.data]);

  // fresh state each time the dialog opens
  useEffect(() => {
    if (open) {
      setMonth('');
      setNoJobs(null);
      setTouched(false);
    }
  }, [open]);
  // default: oldest month that still has uninvoiced jobs, else last month
  useEffect(() => {
    if (!open || month !== '' || uninvoiced.isLoading) return;
    setMonth(months[0]?.key ?? previousMonth(todayInHelsinki()));
  }, [open, month, months, uninvoiced.isLoading]);

  const monthLabel = (key: string) => {
    if (!MONTH_RE.test(key)) return key;
    const d = new Date(`${key}-01T12:00:00Z`);
    return d.toLocaleDateString(i18n.language === 'fi' ? 'fi-FI' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  };

  const selected = months.find((m) => m.key === month);
  const truncated = (uninvoiced.data?.total ?? 0) > PAGE;
  const monthValid = MONTH_RE.test(month);

  const mutation = useMutation({
    mutationFn: (m: string) => api.post<{ invoice: CreatedInvoice }>(`/contracts/${contract.id}/invoice-month`, { month: m }),
    onSuccess: (res) => {
      const invoice = res.invoice;
      toast.success(
        t('invoiceMonth.success', { number: invoice.numberFormatted, amount: fmtEUR(invoice.totalGrossCents) }),
        {
          duration: 10_000,
          action: { label: t('invoiceMonth.openInvoice'), onClick: () => navigate(`/invoices/${invoice.id}`) },
        },
      );
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      void queryClient.invalidateQueries({ queryKey: ['lookups'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err, m) => {
      if (err instanceof ApiError && err.code === 'NO_JOBS') {
        setNoJobs(m);
        void queryClient.invalidateQueries({ queryKey: ['contracts', contract.id] });
        return;
      }
      toast.error(errorMessage(err, t('common:common.errorTitle')));
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!monthValid) return;
    setNoJobs(null);
    mutation.mutate(month);
  };

  const close = () => {
    if (!mutation.isPending) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('invoiceMonth.title', { name: contract.name })}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form="invoice-month-form" disabled={mutation.isPending || !monthValid}>
            {mutation.isPending ? t('invoiceMonth.saving') : t('invoiceMonth.submit')}
          </Button>
        </>
      }
    >
      <form id="invoice-month-form" onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-xs text-muted-foreground">{t('invoiceMonth.intro', { company: contract.customer.name })}</p>

        <Field
          label={t('invoiceMonth.month')}
          error={touched && !monthValid ? t('validation.monthRequired') : undefined}
          required
        >
          <Input
            type="month"
            autoFocus
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setNoJobs(null);
            }}
            max={monthOf(todayInHelsinki())}
          />
        </Field>

        <div className="space-y-1.5">
          <p className="text-xs font-medium">{t('invoiceMonth.monthsWithJobs')}</p>
          {uninvoiced.isLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner className="h-4 w-4" /> {t('common:common.loading')}
            </div>
          ) : uninvoiced.isError ? (
            <p className="text-xs text-destructive">
              {errorMessage(uninvoiced.error, t('common:common.errorTitle'))}{' '}
              <button type="button" className="underline" onClick={() => void uninvoiced.refetch()}>
                {t('common:action.retry')}
              </button>
            </p>
          ) : months.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('invoiceMonth.nothingUninvoiced')}</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {months.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  aria-pressed={m.key === month}
                  onClick={() => {
                    setMonth(m.key);
                    setNoJobs(null);
                  }}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    m.key === month ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
                  )}
                >
                  <span className="font-medium capitalize">{monthLabel(m.key)}</span>
                  <span className="block text-2xs opacity-80">
                    {t('invoiceMonth.jobCount', { count: m.count })} · {fmtEUR(m.cents)}
                  </span>
                </button>
              ))}
            </div>
          )}
          {truncated ? <p className="text-2xs text-muted-foreground">{t('invoiceMonth.truncated')}</p> : null}
        </div>

        {monthValid && !uninvoiced.isLoading && !uninvoiced.isError ? (
          <p
            className={cn(
              'rounded-md px-3 py-2 text-xs',
              selected ? 'bg-profit/10 text-profit' : 'bg-muted text-muted-foreground',
            )}
            role="status"
          >
            {selected
              ? t('invoiceMonth.preview', {
                  month: monthLabel(month),
                  count: selected.count,
                  amount: fmtEUR(selected.cents),
                })
              : t('invoiceMonth.previewNone', { month: monthLabel(month) })}
          </p>
        ) : null}

        {noJobs ? (
          <div role="alert" className="flex items-start gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{t('invoiceMonth.noJobs', { month: monthLabel(noJobs) })}</span>
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}
