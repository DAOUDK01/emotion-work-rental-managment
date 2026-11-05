import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import i18n from '@/lib/i18n';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { centsToInput, fmtDate } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/misc';
import { DraftEditor, type DraftInitial } from './DraftEditor';
import { InvoiceDetailView } from './InvoiceDetailView';
import {
  DEFAULT_TERMS_DAYS,
  blankLine,
  defaultVatRateOn,
  dueDateFrom,
  nextLineKey,
  type CustomerHit,
  type InvoiceDetail,
  type InvoiceLanguage,
  type InvoiceResponse,
  type Lookups,
  type RentalForInvoice,
} from './types';

function positiveInt(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const n = Number(value);
  return n > 0 ? n : null;
}

/** "01.09–30.09.2026" fallback when a rental has no recorded period text. */
function rentalPeriod(rental: RentalForInvoice): string {
  if (rental.periodText) return rental.periodText;
  return rental.endDate ? `${fmtDate(rental.startDate)} – ${fmtDate(rental.endDate)}` : fmtDate(rental.startDate);
}

function initialFromInvoice(invoice: InvoiceDetail): DraftInitial {
  return {
    header: {
      language: invoice.language,
      modelId: invoice.model ? String(invoice.model.id) : '',
      unitId: invoice.unit ? String(invoice.unit.id) : '',
      issueDate: invoice.issueDate,
      termsDays: String(invoice.termsDays),
      dueDate: invoice.dueDate,
      deliveryDate: invoice.deliveryDate ?? '',
      periodText: invoice.periodText ?? '',
      notes: invoice.notes ?? '',
    },
    customer: { id: invoice.customer.id, name: invoice.customer.name, type: invoice.customer.type },
    lines: invoice.lines.map((l) => ({
      key: nextLineKey(),
      productId: l.productId,
      productSku: l.product?.sku ?? null,
      description: l.description,
      qty: String(l.qty),
      unitPrice: centsToInput(l.unitPriceCents),
      discount: l.discountCents ? centsToInput(l.discountCents) : '',
      vatRateBp: l.vatRateBp,
      isLabour: l.isLabour,
    })),
    presetUnit: invoice.unit,
    rentalId: invoice.rentalId,
  };
}

function initialForNew(
  lookups: Lookups,
  rental: RentalForInvoice | null,
  rentalCustomer: CustomerHit | null,
): DraftInitial {
  const today = todayInHelsinki();
  const vat = defaultVatRateOn(lookups, today);
  const language: InvoiceLanguage = rentalCustomer?.language ?? 'EN';
  const header = {
    language,
    modelId: '',
    unitId: '',
    issueDate: today,
    termsDays: String(DEFAULT_TERMS_DAYS),
    dueDate: dueDateFrom(today, DEFAULT_TERMS_DAYS),
    deliveryDate: '',
    periodText: '',
    notes: '',
  };
  if (!rental) return { header, customer: null, lines: [blankLine(vat)], presetUnit: null, rentalId: null };

  const rentalModel = lookups.models.find((m) => m.code === 'RENTAL');
  const period = rentalPeriod(rental);
  const fixedT = i18n.getFixedT(language === 'FI' ? 'fi' : 'en', 'invoices');
  return {
    header: {
      ...header,
      modelId: rentalModel ? String(rentalModel.id) : '',
      unitId: String(rental.unit.id),
      deliveryDate: rental.startDate,
      periodText: period.slice(0, 120),
    },
    customer: rental.customer
      ? {
          id: rental.customer.id,
          name: rental.customer.name,
          type: rental.customer.type,
          email: rentalCustomer?.email ?? null,
          language: rentalCustomer?.language,
        }
      : null,
    lines: [
      {
        key: nextLineKey(),
        productId: null,
        productSku: null,
        description: fixedT('editor.rentalLine', { period }).slice(0, 300),
        qty: '1',
        unitPrice: centsToInput(rental.amountCents),
        discount: '',
        vatRateBp: rental.entry?.vatRateBp ?? vat,
        isLabour: false,
      },
    ],
    presetUnit: rental.unit,
    rentalId: rental.id,
  };
}

/** /invoices/new (optionally ?rentalId=) and /invoices/:id — DRAFT editor or read-only detail. */
export default function InvoiceEditorPage() {
  const { t } = useTranslation('invoices');
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const isNew = id === undefined;
  const invoiceId = positiveInt(id);
  const rentalId = useMemo(
    () => (isNew ? positiveInt(new URLSearchParams(location.search).get('rentalId')) : null),
    [isNew, location.search],
  );

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
  const invoice = useQuery({
    queryKey: ['invoices', invoiceId],
    queryFn: () => api.get<InvoiceResponse>(`/invoices/${invoiceId}`),
    enabled: invoiceId !== null,
  });
  const rental = useQuery({
    queryKey: ['rentals', rentalId],
    queryFn: () => api.get<{ rental: RentalForInvoice }>(`/rentals/${rentalId}`),
    enabled: rentalId !== null,
  });
  const rentalCustomerId = rental.data?.rental.customer?.id ?? null;
  const rentalCustomer = useQuery({
    queryKey: ['customers', rentalCustomerId],
    queryFn: () => api.get<{ customer: CustomerHit }>(`/customers/${rentalCustomerId}`),
    enabled: rentalCustomerId !== null,
    retry: false,
  });

  const inv = invoice.data?.invoice ?? null;
  const editableDraft = inv !== null && inv.status === 'DRAFT' && canWrite;

  // build the editor's starting state once per invoice / rental (later refetches must not wipe edits)
  const draftKey = inv ? `invoice-${inv.id}` : `new-${rentalId ?? 'blank'}`;
  const initial = useMemo<DraftInitial | null>(() => {
    if (!lookups.data) return null;
    if (inv) return editableDraft ? initialFromInvoice(inv) : null;
    if (!isNew) return null;
    if (rentalId !== null) {
      if (!rental.data) return null;
      // wait for the customer card (language/email) — a failed lookup just falls back to defaults
      if (rentalCustomerId !== null && rentalCustomer.isPending) return null;
      return initialForNew(lookups.data, rental.data.rental, rentalCustomer.data?.customer ?? null);
    }
    return initialForNew(lookups.data, null, null);
    // `inv` is intentionally read via draftKey: a refetch of the same invoice keeps the editor state
  }, [draftKey, lookups.data, editableDraft, rental.data, rentalCustomerId, rentalCustomer.isPending, rentalCustomer.data]);

  const backLink = (
    <Link to="/invoices" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
      <ArrowLeft className="h-4 w-4" /> {t('actions.backToList')}
    </Link>
  );

  // ---- invalid id / forbidden create
  if (!isNew && invoiceId === null) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader title={t('detail.notFound')} actions={backLink} />
        <EmptyState title={t('detail.notFound')} hint={t('detail.notFoundHint')} />
      </div>
    );
  }
  if (isNew && !canWrite) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader title={t('editor.newTitle')} actions={backLink} />
        <EmptyState title={t('detail.readOnlyHint')} />
      </div>
    );
  }

  // ---- loading / error
  const failed = [lookups, invoice, rental].find((q) => q.isError);
  if (failed) {
    const notFound = failed.error instanceof ApiError && failed.error.status === 404;
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader title={isNew ? t('editor.newTitle') : t('detail.loadingTitle')} actions={backLink} />
        {notFound ? (
          <EmptyState
            title={failed === rental ? t('editor.rentalNotFound') : t('detail.notFound')}
            hint={t('detail.notFoundHint')}
          />
        ) : (
          <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
        )}
      </div>
    );
  }

  if (inv && !editableDraft) return <InvoiceDetailView invoice={inv} canWrite={canWrite} />;

  if (!initial || !lookups.data) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader title={isNew ? t('editor.newTitle') : t('detail.loadingTitle')} actions={backLink} />
        <LoadingState label={t('common:common.loading')} />
      </div>
    );
  }

  const warnings: string[] = [];
  const r = rental.data?.rental;
  if (isNew && r) {
    warnings.push(t('editor.fromRental', { id: r.id, period: rentalPeriod(r) }));
    if (r.status === 'VOID') warnings.push(t('editor.rentalVoid'));
    if (r.entry?.paymentStatus === 'PAID') warnings.push(t('editor.rentalPaid'));
    if (!r.customer) warnings.push(t('editor.rentalNoCustomer', { name: r.customerName ?? '–' }));
  }

  return <DraftEditor key={draftKey} invoice={inv} initial={initial} lookups={lookups.data} warnings={warnings} />;
}
