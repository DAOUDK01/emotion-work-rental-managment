import { useTranslation } from 'react-i18next';
import { Check, X } from 'lucide-react';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import { creditedCents, remainingCents, statusBadgeVariant, type InvoiceDetail, type InvoiceStatus } from './types';

type Step = { key: InvoiceStatus; tone: 'done' | 'current' | 'todo' | 'cancelled' };

function timelineSteps(status: InvoiceStatus): Step[] {
  if (status === 'CANCELLED') {
    return [
      { key: 'DRAFT', tone: 'done' },
      { key: 'SENT', tone: 'done' },
      { key: 'CANCELLED', tone: 'cancelled' },
    ];
  }
  const order: InvoiceStatus[] = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID'];
  const current = order.indexOf(status);
  return order.map((key, i) => ({
    key,
    tone: i < current || (key === 'PAID' && status === 'PAID') ? 'done' : i === current ? 'current' : 'todo',
  }));
}

/** Draft → Sent → Partially paid → Paid (or → Cancelled after a full credit note). */
export function StatusTimeline({ status }: { status: InvoiceStatus }) {
  const { t } = useTranslation('invoices');
  const steps = timelineSteps(status);
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2" aria-label={t('detail.timeline')}>
      {steps.map((step, i) => (
        <li
          key={step.key}
          className="flex items-center gap-1"
          aria-current={step.tone === 'current' || (step.tone !== 'todo' && i === steps.length - 1) ? 'step' : undefined}
        >
          <span
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold',
              step.tone === 'done' && 'border-profit bg-profit text-white',
              step.tone === 'current' && 'border-primary bg-primary text-primary-foreground',
              step.tone === 'todo' && 'border-input text-muted-foreground',
              step.tone === 'cancelled' && 'border-loss bg-loss text-white',
            )}
            aria-hidden
          >
            {step.tone === 'done' ? (
              <Check className="h-3.5 w-3.5" />
            ) : step.tone === 'cancelled' ? (
              <X className="h-3.5 w-3.5" />
            ) : (
              i + 1
            )}
          </span>
          <span
            className={cn(
              'text-xs',
              step.tone === 'todo' ? 'text-muted-foreground' : 'font-medium',
              step.tone === 'cancelled' && 'text-loss',
            )}
          >
            {t(`status.${step.key}`)}
          </span>
          {i < steps.length - 1 ? <span className="mx-1 h-px w-5 bg-border sm:w-8" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

export function InvoiceStatusBadges({ status, isOverdue }: { status: InvoiceStatus; isOverdue: boolean }) {
  const { t } = useTranslation('invoices');
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant={statusBadgeVariant(status)}>{t(`status.${status}`)}</Badge>
      {isOverdue ? <Badge variant="danger">{t('status.OVERDUE')}</Badge> : null}
    </span>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{children}</dd>
    </div>
  );
}

/** Invoice identity, timeline, key dates and the money position. */
export function InvoiceSummaryCard({ invoice, actions }: { invoice: InvoiceDetail; actions?: React.ReactNode }) {
  const { t, i18n } = useTranslation('invoices');
  const credited = creditedCents(invoice);
  const remaining = remainingCents(invoice);
  const modelName = invoice.model ? (i18n.language === 'fi' ? invoice.model.nameFi : invoice.model.nameEn) : null;

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold tabular-nums">{invoice.numberFormatted}</h2>
              <InvoiceStatusBadges status={invoice.status} isOverdue={invoice.isOverdue} />
            </div>
            <p className="text-sm text-muted-foreground">{invoice.customer.name}</p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>

        <StatusTimeline status={invoice.status} />

        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label={t('fields.issueDate')}>{fmtDate(invoice.issueDate)}</Fact>
          <Fact label={t('fields.dueDate')}>
            <span className={cn(invoice.isOverdue && 'font-semibold text-loss')}>{fmtDate(invoice.dueDate)}</span>
            <span className="text-muted-foreground"> · {t('fields.termsShort', { days: invoice.termsDays })}</span>
          </Fact>
          <Fact label={t('fields.reference')}>
            <span className="font-mono tabular-nums">{invoice.referenceNumberFormatted}</span>
          </Fact>
          <Fact label={t('fields.language')}>{t(`language.${invoice.language}`)}</Fact>
          <Fact label={t('fields.deliveryPeriod')}>
            {invoice.periodText ?? (invoice.deliveryDate ? fmtDate(invoice.deliveryDate) : '–')}
          </Fact>
          <Fact label={t('fields.modelUnit')}>
            {[modelName, invoice.unit?.code].filter(Boolean).join(' · ') || '–'}
          </Fact>
        </dl>

        <dl className="grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-4">
          <Fact label={t('totals.gross')}>
            <span className="text-base font-semibold tabular-nums">{fmtEUR(invoice.totalGrossCents)}</span>
          </Fact>
          <Fact label={t('detail.paid')}>
            <span className="text-base font-semibold tabular-nums text-profit">{fmtEUR(invoice.paidCents)}</span>
          </Fact>
          <Fact label={t('detail.credited')}>
            <span className="text-base font-semibold tabular-nums">{fmtEUR(credited)}</span>
          </Fact>
          <Fact label={t('detail.remaining')}>
            <span className={cn('text-base font-semibold tabular-nums', remaining > 0 && 'text-loss')}>
              {fmtEUR(remaining)}
            </span>
          </Fact>
        </dl>

        {invoice.sentAt ? (
          <p className="text-2xs text-muted-foreground">
            {invoice.emailedTo
              ? t('detail.sentTo', { date: fmtDate(invoice.sentAt), email: invoice.emailedTo })
              : t('detail.sentNoEmail', { date: fmtDate(invoice.sentAt) })}
            {invoice.entry ? ` · ${t('detail.entryLinked', { id: invoice.entry.id })}` : ''}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
