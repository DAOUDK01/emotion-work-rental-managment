import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlarmClock, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState, PageHeader, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { InvoiceStatusBadges } from './InvoiceHeader';
import type { InvoiceListResponse, InvoiceStatus } from './types';

const PAGE_SIZE = 50;
const STATUSES: InvoiceStatus[] = ['DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'];
type StatusFilter = '' | InvoiceStatus | 'OVERDUE';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function readStatus(params: URLSearchParams): StatusFilter {
  if (params.get('overdue') === '1' || params.get('overdue') === 'true') return 'OVERDUE';
  const s = params.get('status') ?? '';
  return s === 'OVERDUE' || (STATUSES as string[]).includes(s) ? (s as StatusFilter) : '';
}

/** Invoice register: filters live in the URL so "back" from an invoice restores them. */
export default function InvoicesPage() {
  const { t } = useTranslation('invoices');
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const [params, setParams] = useSearchParams();

  const status = readStatus(params);
  const q = params.get('q') ?? '';
  const from = ISO.test(params.get('from') ?? '') ? (params.get('from') as string) : '';
  const to = ISO.test(params.get('to') ?? '') ? (params.get('to') as string) : '';
  const customerId = /^\d+$/.test(params.get('customerId') ?? '') ? Number(params.get('customerId')) : null;
  const page = Math.max(1, Number(params.get('page')) || 1);

  const update = (patch: Record<string, string | null>, keepPage = false) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        if (!keepPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };
  const setStatus = (s: StatusFilter) =>
    update({ status: s && s !== 'OVERDUE' ? s : null, overdue: s === 'OVERDUE' ? '1' : null });

  // debounced search box → URL
  const [search, setSearch] = useState(q);
  useEffect(() => {
    // external change (back/forward, clear filters) — keep what the user is typing otherwise
    setSearch((s) => (s.trim() === q ? s : q));
  }, [q]);
  useEffect(() => {
    if (search.trim() === q) return;
    // `update` only goes through the functional params setter, so a stale closure is safe here
    const handle = setTimeout(() => update({ q: search.trim() || null }), 300);
    return () => clearTimeout(handle);
  }, [search, q]);

  const filterQs = useMemo(
    () =>
      qs({
        status: status && status !== 'OVERDUE' ? status : undefined,
        overdue: status === 'OVERDUE' ? 'true' : undefined,
        customerId: customerId ?? undefined,
        q: q || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [status, customerId, q, from, to, page],
  );

  const list = useQuery({
    queryKey: ['invoices', 'list', filterQs],
    queryFn: () => api.get<InvoiceListResponse>('/invoices' + filterQs),
    placeholderData: keepPreviousData,
  });

  const filtersActive = Boolean(status || q || from || to || customerId);
  const clearFilters = () => {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const customerChipName = customerId ? data?.invoices.find((i) => i.customer.id === customerId)?.customer.name : undefined;
  const open = (id: number) => navigate(`/invoices/${id}`);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('list.title')}
        description={t('list.subtitle')}
        actions={
          <>
            <Button
              variant={status === 'OVERDUE' ? 'destructive' : 'outline'}
              aria-pressed={status === 'OVERDUE'}
              onClick={() => setStatus(status === 'OVERDUE' ? '' : 'OVERDUE')}
            >
              <AlarmClock className="h-4 w-4" /> {t('list.overdueList')}
            </Button>
            {canWrite ? (
              <Button onClick={() => navigate('/invoices/new')}>
                <Plus className="h-4 w-4" /> {t('actions.newInvoice')}
              </Button>
            ) : null}
          </>
        }
      />

      {/* filters */}
      <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto_auto_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="invoice-search">{t('list.search')}</Label>
          <Input
            id="invoice-search"
            type="search"
            placeholder={t('list.searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-status">{t('common:common.status')}</Label>
          <Select id="invoice-status" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            <option value="">{t('list.allStatuses')}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
            <option value="OVERDUE">{t('list.overdueOption')}</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-from">{t('list.issuedFrom')}</Label>
          <Input
            id="invoice-from"
            type="date"
            className="lg:w-40"
            value={from}
            max={to || undefined}
            onChange={(e) => update({ from: e.target.value || null })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invoice-to">{t('list.issuedTo')}</Label>
          <Input
            id="invoice-to"
            type="date"
            className="lg:w-40"
            value={to}
            min={from || undefined}
            onChange={(e) => update({ to: e.target.value || null })}
          />
        </div>
        <Button variant="ghost" onClick={clearFilters} disabled={!filtersActive}>
          <X className="h-4 w-4" /> {t('list.clearFilters')}
        </Button>
      </div>

      {customerId ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border bg-muted/50 px-2.5 py-1">
            {t('list.customerFilter', { name: customerChipName ?? `#${customerId}` })}
          </span>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => update({ customerId: null })}>
            {t('list.removeCustomerFilter')}
          </Button>
        </div>
      ) : null}

      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : !data || data.invoices.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title={status === 'OVERDUE' ? t('list.noOverdue') : t('list.emptyFiltered')}
            hint={status === 'OVERDUE' ? t('list.noOverdueHint') : t('list.emptyFilteredHint')}
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t('list.clearFilters')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('list.empty')}
            hint={t('list.emptyHint')}
            action={
              canWrite ? (
                <Button size="sm" onClick={() => navigate('/invoices/new')}>
                  <Plus className="h-4 w-4" /> {t('actions.newInvoice')}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="space-y-3">
          <div className="relative">
            {list.isFetching && !list.isLoading ? (
              <div className="absolute right-2 top-2 z-10" aria-hidden>
                <Spinner className="h-4 w-4" />
              </div>
            ) : null}
            <Table className="min-w-[860px]">
              <THead>
                <TR>
                  <TH>{t('list.number')}</TH>
                  <TH>{t('list.customer')}</TH>
                  <TH>{t('fields.issueDate')}</TH>
                  <TH>{t('fields.dueDate')}</TH>
                  <TH className="text-right">{t('list.total')}</TH>
                  <TH className="text-right">{t('detail.paid')}</TH>
                  <TH>{t('common:common.status')}</TH>
                  <TH>{t('fields.reference')}</TH>
                </TR>
              </THead>
              <TBody>
                {data.invoices.map((inv) => (
                  <TR
                    key={inv.id}
                    tabIndex={0}
                    role="link"
                    aria-label={t('list.openInvoice', { number: inv.numberFormatted, customer: inv.customer.name })}
                    className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                    onClick={() => open(inv.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        open(inv.id);
                      }
                    }}
                  >
                    <TD className="whitespace-nowrap font-medium tabular-nums">{inv.numberFormatted}</TD>
                    <TD className="max-w-[220px] truncate">{inv.customer.name}</TD>
                    <TD className="whitespace-nowrap">{fmtDate(inv.issueDate)}</TD>
                    <TD className={cn('whitespace-nowrap', inv.isOverdue && 'font-semibold text-loss')}>
                      {fmtDate(inv.dueDate)}
                    </TD>
                    <TDMoney className="font-medium">{fmtEUR(inv.totalGrossCents)}</TDMoney>
                    <TDMoney className={inv.paidCents > 0 ? 'text-profit' : 'text-muted-foreground'}>
                      {fmtEUR(inv.paidCents)}
                    </TDMoney>
                    <TD>
                      <InvoiceStatusBadges status={inv.status} isOverdue={inv.isOverdue} />
                    </TD>
                    <TD className="whitespace-nowrap font-mono text-xs tabular-nums">{inv.referenceNumberFormatted}</TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD colSpan={4}>{t('list.sumsLabel', { count: data.total })}</TD>
                  <TDMoney>{fmtEUR(data.sums.grossCents)}</TDMoney>
                  <TDMoney className="text-profit">{fmtEUR(data.sums.paidCents)}</TDMoney>
                  <TD colSpan={2} className="text-xs font-normal">
                    <div>
                      {t('list.outstanding')}: <span className="font-semibold tabular-nums">{fmtEUR(data.sums.outstandingCents)}</span>
                    </div>
                    <div className={data.sums.overdueCents > 0 ? 'text-loss' : 'text-muted-foreground'}>
                      {t('list.overdue')}: <span className="font-semibold tabular-nums">{fmtEUR(data.sums.overdueCents)}</span>
                    </div>
                  </TD>
                </TR>
              </TFoot>
            </Table>
          </div>
          <p className="text-2xs text-muted-foreground">
            {t('list.sumsHint', { net: fmtEUR(data.sums.netCents), vat: fmtEUR(data.sums.vatCents) })}
          </p>

          {data.total > data.pageSize ? (
            <nav className="flex items-center justify-end gap-2" aria-label={t('list.pagination')}>
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) }, true)}
              >
                <ChevronLeft className="h-4 w-4" /> {t('list.previous')}
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {t('common:common.page')} {page} {t('common:common.of')} {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => update({ page: String(page + 1) }, true)}
              >
                {t('common:action.next')} <ChevronRight className="h-4 w-4" />
              </Button>
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
