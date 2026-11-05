import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban, CalendarPlus, Check, CircleDollarSign, FileText, Pencil, Plus, Repeat, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import MarkPaidDialog from './MarkPaidDialog';
import RecurringSection from './RecurringSection';
import RentalDialog from './RentalDialog';
import RowActionsMenu, { type MenuItem } from './RowActionsMenu';
import {
  customerLabel,
  errorMessage,
  PAYMENT_STATUSES,
  paymentVariant,
  periodLabel,
  type Lookups,
  type PaymentStatus,
  type RentalDetail,
  type RentalRow,
  type RentalsResponse,
  type UnitsResponse,
} from './types';
import { useGenerateNext } from './useGenerateNext';

const PAGE_SIZE = 50;
/** With "needs review only" we scan a bigger page (the API has no needsReview filter for rentals). */
const REVIEW_SCAN_SIZE = 200;

type StatusFilter = 'ACTIVE' | 'VOID' | '';

export default function RentalsPage() {
  const { t } = useTranslation('rentals');
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const generateNext = useGenerateNext();

  // ---- filters
  const [status, setStatus] = useState<StatusFilter>('ACTIVE');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus | ''>('');
  const [unitId, setUnitId] = useState<number | 0>(0);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  // any filter change → back to page 1
  useEffect(() => setPage(1), [status, paymentStatus, unitId, q, from, to, needsReviewOnly]);

  const hasFilters = Boolean(paymentStatus || unitId || q || from || to || needsReviewOnly || status !== 'ACTIVE');
  const clearFilters = () => {
    setStatus('ACTIVE');
    setPaymentStatus('');
    setUnitId(0);
    setSearch('');
    setQ('');
    setFrom('');
    setTo('');
    setNeedsReviewOnly(false);
  };

  const filterQs = useMemo(
    () =>
      qs({
        status: status || undefined,
        paymentStatus: paymentStatus || undefined,
        unitId: unitId || undefined,
        q: q || undefined,
        from: from || undefined,
        to: to || undefined,
        page: needsReviewOnly ? 1 : page,
        pageSize: needsReviewOnly ? REVIEW_SCAN_SIZE : PAGE_SIZE,
      }),
    [status, paymentStatus, unitId, q, from, to, page, needsReviewOnly],
  );

  // ---- data
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
  const units = useQuery({
    queryKey: ['units', 'list', '?pageSize=200'],
    queryFn: () => api.get<UnitsResponse>('/units' + qs({ pageSize: 200 })),
    staleTime: 60_000,
  });
  const list = useQuery({
    queryKey: ['rentals', 'list', filterQs],
    queryFn: () => api.get<RentalsResponse>('/rentals' + filterQs),
    placeholderData: (prev) => prev,
  });

  const rows = useMemo(() => {
    const all = list.data?.rentals ?? [];
    return needsReviewOnly ? all.filter((r) => r.needsReview) : all;
  }, [list.data, needsReviewOnly]);
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ---- dialogs
  const [editor, setEditor] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [markPaidRow, setMarkPaidRow] = useState<RentalRow | null>(null);
  const [voidRow, setVoidRow] = useState<RentalRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidError, setVoidError] = useState<string | undefined>();

  const voidMutation = useMutation({
    mutationFn: (v: { id: number; reason: string }) =>
      api.post<{ rental: RentalDetail }>(`/rentals/${v.id}/void`, { reason: v.reason }),
    onSuccess: () => {
      toast.success(t('common:common.voidedOk'));
      void queryClient.invalidateQueries({ queryKey: ['rentals'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      closeVoid();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  function openVoid(r: RentalRow) {
    setVoidReason('');
    setVoidError(undefined);
    setVoidRow(r);
  }
  function closeVoid() {
    setVoidRow(null);
    setVoidReason('');
    setVoidError(undefined);
  }
  function confirmVoid() {
    if (!voidRow) return;
    const reason = voidReason.trim();
    if (!reason) {
      setVoidError(t('void.reasonRequired'));
      return;
    }
    voidMutation.mutate({ id: voidRow.id, reason });
  }

  function rowActions(r: RentalRow): MenuItem[] {
    const isVoid = r.status === 'VOID';
    return [
      {
        key: 'edit',
        label: t('common:action.edit'),
        icon: <Pencil className="h-3.5 w-3.5" />,
        onSelect: () => setEditor({ open: true, id: r.id }),
        disabled: isVoid,
      },
      {
        key: 'markPaid',
        label: t('common:action.markPaid'),
        icon: <CircleDollarSign className="h-3.5 w-3.5" />,
        onSelect: () => setMarkPaidRow(r),
        disabled: isVoid || r.paymentStatus === 'PAID',
      },
      {
        key: 'generateNext',
        label: t('actions.generateNext'),
        icon: <CalendarPlus className="h-3.5 w-3.5" />,
        onSelect: () => generateNext.mutate(r.id),
        disabled: isVoid || (generateNext.isPending && generateNext.variables === r.id),
      },
      {
        key: 'invoice',
        label: t('actions.createInvoice'),
        icon: <FileText className="h-3.5 w-3.5" />,
        onSelect: () => void navigate('/invoices/new?rentalId=' + r.id),
        disabled: isVoid,
      },
      {
        key: 'void',
        label: t('common:action.void'),
        icon: <Ban className="h-3.5 w-3.5" />,
        onSelect: () => openVoid(r),
        destructive: true,
        disabled: isVoid,
      },
    ];
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          canWrite ? (
            <Button onClick={() => setEditor({ open: true, id: null })}>
              <Plus className="h-4 w-4" aria-hidden /> {t('actions.new')}
            </Button>
          ) : null
        }
      />

      {lookups.isError || units.isError ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs font-medium"
          role="alert"
        >
          <span>{t('list.lookupsError')}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (lookups.isError) void lookups.refetch();
              if (units.isError) void units.refetch();
            }}
          >
            {t('common:action.retry')}
          </Button>
        </div>
      ) : null}

      <RecurringSection canWrite={canWrite} />

      {/* ---------- filters ---------- */}
      <section aria-label={t('filters.title')} className="space-y-2 rounded-lg border bg-card p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <Field label={t('filters.search')} className="sm:col-span-2">
            <Input
              type="search"
              aria-label={t('filters.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('filters.searchPlaceholder')}
            />
          </Field>
          <Field label={t('filters.paymentStatus')}>
            <Select aria-label={t('filters.paymentStatus')} value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value as PaymentStatus | '')}>
              <option value="">{t('common:common.all')}</option>
              {PAYMENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`common:status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('filters.unit')}>
            <Select aria-label={t('filters.unit')} value={unitId} onChange={(e) => setUnitId(Number(e.target.value))}>
              <option value={0}>{t('filters.allUnits')}</option>
              {(units.data?.units ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('filters.from')}>
            <Input type="date" aria-label={t('filters.from')} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t('filters.to')}>
            <Input type="date" aria-label={t('filters.to')} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Field label={t('filters.status')} className="flex items-center gap-2 space-y-0">
            <Select
              aria-label={t('filters.status')}
              className="h-8 w-36 text-xs"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
            >
              <option value="ACTIVE">{t('common:status.ACTIVE')}</option>
              <option value="VOID">{t('common:status.VOID')}</option>
              <option value="">{t('common:common.all')}</option>
            </Select>
          </Field>
          <Checkbox
            label={t('filters.needsReview')}
            checked={needsReviewOnly}
            onChange={(e) => setNeedsReviewOnly(e.target.checked)}
          />
          {hasFilters ? (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" aria-hidden /> {t('filters.clear')}
            </Button>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground" aria-live="polite">
            {list.data
              ? needsReviewOnly
                ? t('list.reviewCount', { count: rows.length })
                : t('list.count', { count: total })
              : null}
          </span>
        </div>
      </section>

      {/* ---------- list ---------- */}
      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title={t('list.noMatchTitle')}
            hint={t('list.noMatchHint')}
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t('filters.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('list.emptyTitle')}
            hint={t('list.emptyHint')}
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setEditor({ open: true, id: null })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {t('actions.new')}
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <>
          <Table className={list.isFetching ? 'opacity-70 transition-opacity' : undefined}>
            <THead>
              <TR>
                <TH>{t('table.unit')}</TH>
                <TH>{t('table.customer')}</TH>
                <TH>{t('table.period')}</TH>
                <TH className="text-right">{t('table.amount')}</TH>
                <TH className="hidden text-right md:table-cell">{t('table.deposit')}</TH>
                <TH>{t('table.payment')}</TH>
                <TH className="hidden md:table-cell">{t('table.receivedBy')}</TH>
                <TH className="text-center">
                  <span title={t('table.agreement')}>{t('table.agreementShort')}</span>
                </TH>
                <TH className="text-center">
                  <span title={t('table.recurring')}>
                    <Repeat className="mx-auto h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">{t('table.recurring')}</span>
                  </span>
                </TH>
                {canWrite ? (
                  <TH className="w-10">
                    <span className="sr-only">{t('common:common.actions')}</span>
                  </TH>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const isVoid = r.status === 'VOID';
                return (
                  <TR key={r.id} className={isVoid ? 'text-muted-foreground' : undefined}>
                    <TD className="whitespace-nowrap">
                      <span className={isVoid ? 'font-medium line-through' : 'font-medium'}>{r.unit.code}</span>
                      <span className="block text-2xs text-muted-foreground">{r.unit.brand}</span>
                    </TD>
                    <TD className="max-w-[12rem]">
                      <span className="block truncate">{customerLabel(r)}</span>
                      {r.customer ? null : r.customerName ? (
                        <span className="block text-2xs text-muted-foreground">{t('table.unlinked')}</span>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap">{periodLabel(r)}</TD>
                    <TDMoney>{fmtEUR(r.amountCents)}</TDMoney>
                    <TDMoney className="hidden md:table-cell">{r.depositCents ? fmtEUR(r.depositCents) : '–'}</TDMoney>
                    <TD>
                      <div className="flex flex-wrap items-center gap-1">
                        {isVoid ? (
                          <Badge variant="danger">{t('common:status.VOID')}</Badge>
                        ) : (
                          <Badge variant={paymentVariant(r.paymentStatus)}>
                            {r.paymentStatus ? t(`common:status.${r.paymentStatus}`) : t('table.noEntry')}
                          </Badge>
                        )}
                        {r.needsReview ? (
                          <Badge variant="warning" title={r.reviewReason ?? undefined}>
                            {t('common:common.needsReview')}
                          </Badge>
                        ) : null}
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">{r.receivedBy?.name ?? '–'}</TD>
                    <TD className="text-center">
                      {r.agreementSigned ? (
                        <>
                          <Check className="mx-auto h-4 w-4 text-profit" aria-hidden />
                          <span className="sr-only">{t('table.agreementSigned')}</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden>–</span>
                          <span className="sr-only">{t('table.agreementMissing')}</span>
                        </>
                      )}
                    </TD>
                    <TD className="text-center">
                      {r.recurring ? (
                        <span title={t('table.recurring')}>
                          <Repeat className="mx-auto h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden />
                          <span className="sr-only">{t('table.recurring')}</span>
                        </span>
                      ) : null}
                    </TD>
                    {canWrite ? (
                      <TD className="px-1 text-right">
                        <RowActionsMenu
                          label={t('actions.menuFor', { unit: r.unit.code })}
                          items={rowActions(r)}
                        />
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
          </Table>

          {needsReviewOnly && total > REVIEW_SCAN_SIZE ? (
            <p className="text-2xs text-muted-foreground">{t('list.reviewScanNote', { count: REVIEW_SCAN_SIZE })}</p>
          ) : null}

          {!needsReviewOnly && total > PAGE_SIZE ? (
            <nav className="flex items-center justify-between gap-2" aria-label={t('list.pagination')}>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                {t('common:action.back')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('common:common.page')} {page} {t('common:common.of')} {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                {t('common:action.next')}
              </Button>
            </nav>
          ) : null}
        </>
      )}

      {/* ---------- dialogs ---------- */}
      <RentalDialog
        open={editor.open}
        rentalId={editor.id}
        units={units.data?.units ?? []}
        lookups={lookups.data}
        onClose={() => setEditor({ open: false, id: null })}
      />

      <MarkPaidDialog rental={markPaidRow} lookups={lookups.data} onClose={() => setMarkPaidRow(null)} />

      <ConfirmDialog
        open={voidRow !== null}
        onClose={voidMutation.isPending ? () => undefined : closeVoid}
        onConfirm={confirmVoid}
        title={t('void.title')}
        message={voidRow ? t('void.message', { unit: voidRow.unit.code, period: periodLabel(voidRow) }) : ''}
        confirmLabel={t('common:action.void')}
        busy={voidMutation.isPending}
      >
        <Field label={t('void.reason')} error={voidError} required className="mt-3">
          <Textarea
            value={voidReason}
            maxLength={500}
            autoFocus
            onChange={(e) => {
              setVoidReason(e.target.value);
              if (voidError) setVoidError(undefined);
            }}
            placeholder={t('void.reasonPlaceholder')}
          />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
