import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban, ChevronLeft, ChevronRight, Paperclip, Pencil, Plus, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { fmtDate, fmtEUR, fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { ExpenseFormDialog } from './ExpenseFormDialog';
import { UnitSelect } from './Pickers';
import { VoidReasonDialog } from './VoidReasonDialog';
import {
  PAGE_SIZE,
  attachmentUrl,
  categoryLabel,
  errorMessage,
  type AttachmentRef,
  type ExpenseList,
  type ExpenseRow,
  type Lookups,
} from './types';

type ReviewFilter = '' | 'true' | 'false';

/** EXPENSES tab — filters, period sums, the list, create/edit dialog and void. */
export function ExpensesTab({
  lookups,
  canWrite,
  createSignal,
}: {
  lookups: Lookups;
  canWrite: boolean;
  /** Incremented by the page header's "Add expense" button. */
  createSignal: number;
}) {
  const { t, i18n } = useTranslation('expenses');
  const lang = i18n.language;
  const queryClient = useQueryClient();

  const [categoryId, setCategoryId] = useState(0);
  const [paidById, setPaidById] = useState(0);
  const [unitId, setUnitId] = useState<number | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [needsReview, setNeedsReview] = useState<ReviewFilter>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState<ExpenseRow | 'new' | null>(null);
  const [voiding, setVoiding] = useState<ExpenseRow | null>(null);

  // open the create dialog only for header clicks made while this tab is mounted
  const seenSignal = useRef(createSignal);
  useEffect(() => {
    if (createSignal !== seenSignal.current) {
      seenSignal.current = createSignal;
      setEditing('new');
    }
  }, [createSignal]);

  useEffect(() => {
    const h = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(h);
  }, [search]);

  const filterQs = useMemo(
    () =>
      qs({
        categoryId: categoryId || undefined,
        paidById: paidById || undefined,
        unitId: unitId ?? undefined,
        from: from || undefined,
        to: to || undefined,
        needsReview: needsReview || undefined,
        q: q || undefined,
      }),
    [categoryId, paidById, unitId, from, to, needsReview, q],
  );
  useEffect(() => setPage(1), [filterQs]);

  const listQs = filterQs + (filterQs ? '&' : '?') + `page=${page}&pageSize=${PAGE_SIZE}`;
  const list = useQuery({
    queryKey: ['expenses', 'list', listQs],
    queryFn: () => api.get<ExpenseList>('/expenses' + listQs),
    placeholderData: (prev) => prev,
  });

  const voidExpense = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api.post<unknown>(`/expenses/${id}/void`, { reason }),
    onSuccess: (_res, { id }) => {
      toast.success(t('common:common.voidedOk'));
      setVoiding(null);
      const row = list.data?.expenses.find((e) => e.id === id);
      for (const key of ['expenses', 'dashboard', 'vat', 'investments', 'partners']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      if (row?.productId) {
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        void queryClient.invalidateQueries({ queryKey: ['stock'] });
      }
      if (row?.unitId) void queryClient.invalidateQueries({ queryKey: ['units'] });
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const hasFilters = Boolean(categoryId || paidById || unitId || from || to || needsReview || q);
  const clearFilters = () => {
    setCategoryId(0);
    setPaidById(0);
    setUnitId(null);
    setFrom('');
    setTo('');
    setNeedsReview('');
    setSearch('');
    setQ('');
  };

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const periodText =
    from || to ? `${from ? fmtDate(from) : '…'} — ${to ? fmtDate(to) : '…'}` : t('sums.allDates');

  return (
    <div className="space-y-4">
      {/* filters */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('filters.searchPlaceholder')}
          aria-label={t('filters.search')}
          className="sm:col-span-2 lg:col-span-1"
        />
        <Select aria-label={t('filters.category')} value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
          <option value={0}>{t('filters.allCategories')}</option>
          {lookups.expenseCategories.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryLabel(c, lang)}
            </option>
          ))}
        </Select>
        <Select aria-label={t('filters.paidBy')} value={paidById} onChange={(e) => setPaidById(Number(e.target.value))}>
          <option value={0}>{t('filters.anyPayer')}</option>
          {lookups.holders.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </Select>
        <UnitSelect label={t('filters.unit')} value={unitId} onChange={setUnitId} emptyLabel={t('filters.allUnits')} />
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="expenses-from">{t('common:period.from')}</Label>
          <Input id="expenses-from" type="date" className="h-9 w-40" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="expenses-to">{t('common:period.to')}</Label>
          <Input id="expenses-to" type="date" className="h-9 w-40" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="expenses-review">{t('filters.review')}</Label>
          <Select
            id="expenses-review"
            className="w-48"
            value={needsReview}
            onChange={(e) => setNeedsReview(e.target.value as ReviewFilter)}
          >
            <option value="">{t('filters.reviewAll')}</option>
            <option value="true">{t('filters.reviewOnly')}</option>
            <option value="false">{t('filters.reviewNone')}</option>
          </Select>
        </div>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="mb-0.5">
            <X className="h-3.5 w-3.5" /> {t('filters.clear')}
          </Button>
        ) : null}
      </div>

      {/* sums */}
      {data ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label={t('sums.gross')} value={fmtEUR(data.sums.grossCents)} sub={periodText} />
          <KpiCard
            label={t('sums.reclaimable')}
            value={fmtEUR(data.sums.reclaimableVatCents)}
            sub={t('sums.reclaimableHint')}
            tone={data.sums.reclaimableVatCents > 0 ? 'profit' : 'default'}
          />
          <KpiCard label={t('sums.count')} value={fmtNumber(data.total)} sub={t('sums.countHint')} />
        </div>
      ) : null}

      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : data && data.expenses.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title={t('empty.filteredTitle')}
            hint={t('empty.filteredHint')}
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t('filters.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('empty.title')}
            hint={t('empty.hint')}
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setEditing('new')}>
                  <Plus className="h-3.5 w-3.5" /> {t('actions.add')}
                </Button>
              ) : undefined
            }
          />
        )
      ) : data ? (
        <>
          <Table className={cn(list.isFetching && 'opacity-70 transition-opacity')}>
            <THead>
              <TR>
                <TH>{t('common:common.date')}</TH>
                <TH>{t('columns.category')}</TH>
                <TH>{t('columns.description')}</TH>
                <TH>{t('columns.vendor')}</TH>
                <TH>{t('columns.qty')}</TH>
                <TH className="text-right">{t('columns.gross')}</TH>
                <TH className="text-right">{t('columns.reclaimable')}</TH>
                <TH>{t('columns.paidBy')}</TH>
                <TH>
                  <span className="sr-only">{t('columns.receipt')}</span>
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                </TH>
                <TH>{t('common:common.status')}</TH>
                {canWrite ? <TH className="text-right">{t('common:common.actions')}</TH> : null}
              </TR>
            </THead>
            <TBody>
              {data.expenses.map((e) => {
                const isVoid = e.status === 'VOID';
                return (
                  <TR key={e.id} className={cn(isVoid && 'text-muted-foreground')}>
                    <TD className="whitespace-nowrap">
                      {e.expenseDate ? (
                        fmtDate(e.expenseDate)
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden>—</span>
                          <Badge variant="warning" title={e.reviewReason ?? undefined}>
                            {t('table.noDate')}
                          </Badge>
                        </span>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{categoryLabel(e.category, lang)}</TD>
                    <TD className="min-w-[12rem]">
                      <div className={cn('font-medium', isVoid && 'line-through')}>{e.description}</div>
                      {e.unit || e.product || e.purchasedFor ? (
                        <div className="mt-0.5 flex flex-wrap gap-1 text-2xs text-muted-foreground">
                          {e.unit ? <Badge variant="outline">{e.unit.code}</Badge> : null}
                          {e.product ? <Badge variant="outline">{e.product.sku}</Badge> : null}
                          {e.purchasedFor ? <span>{t('table.purchasedFor', { who: e.purchasedFor })}</span> : null}
                        </div>
                      ) : null}
                    </TD>
                    <TD>{e.vendor ?? '–'}</TD>
                    <TD className="whitespace-nowrap">{e.qtyText ?? '–'}</TD>
                    <TDMoney className={cn(isVoid && 'line-through')}>
                      {e.grossCents === null ? <Badge variant="warning">{t('table.noAmount')}</Badge> : fmtEUR(e.grossCents)}
                    </TDMoney>
                    <TDMoney className={cn(!isVoid && e.reclaimableVatCents > 0 && 'text-profit')}>{fmtEUR(e.reclaimableVatCents)}</TDMoney>
                    <TD className="whitespace-nowrap">
                      {e.jointReinvested ? (
                        <span title={t('table.jointTitle')}>
                          {e.paidBy?.name ?? '–'} <Badge variant="info">{t('table.joint')}</Badge>
                        </span>
                      ) : (
                        (e.paidBy?.name ?? '–')
                      )}
                    </TD>
                    <TD>
                      <ReceiptCell attachments={e.attachments} />
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {isVoid ? (
                          <Badge variant="danger" title={e.voidReason ?? undefined}>
                            {t('common:status.VOID')}
                          </Badge>
                        ) : null}
                        {e.needsReview ? (
                          <Badge variant="warning" title={e.reviewReason ?? undefined}>
                            {t('common:common.needsReview')}
                          </Badge>
                        ) : null}
                        {!isVoid && !e.needsReview ? <span className="text-muted-foreground">–</span> : null}
                      </div>
                    </TD>
                    {canWrite ? (
                      <TD className="text-right">
                        {isVoid ? null : (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => setEditing(e)}
                              aria-label={t('actions.editOne', { description: e.description })}
                              title={t('common:action.edit')}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setVoiding(e)}
                              aria-label={t('actions.voidOne', { description: e.description })}
                              title={t('common:action.void')}
                            >
                              <Ban className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={5}>{t('table.totalActive')}</TD>
                <TDMoney>{fmtEUR(data.sums.grossCents)}</TDMoney>
                <TDMoney>{fmtEUR(data.sums.reclaimableVatCents)}</TDMoney>
                <TD colSpan={canWrite ? 4 : 3} />
              </TR>
            </TFoot>
          </Table>

          {data.total > PAGE_SIZE ? (
            <nav className="flex items-center justify-between gap-2" aria-label={t('table.pagination')}>
              <span className="text-xs text-muted-foreground">
                {t('common:common.page')} {page} {t('common:common.of')} {pages} · {t('table.rows', { count: data.total })}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-3.5 w-3.5" /> {t('common:action.back')}
                </Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
                  {t('common:action.next')} <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </nav>
          ) : null}
        </>
      ) : null}

      {editing ? (
        <ExpenseFormDialog
          key={editing === 'new' ? 'new' : editing.id}
          expense={editing === 'new' ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <VoidReasonDialog
        open={voiding !== null}
        title={t('void.expenseTitle')}
        message={
          voiding
            ? t('void.expenseMessage', {
                description: voiding.description,
                amount: fmtEUR(voiding.grossCents),
              })
            : ''
        }
        busy={voidExpense.isPending}
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => voiding && voidExpense.mutate({ id: voiding.id, reason })}
      />
    </div>
  );
}

/** 📎 attachment count; one file opens directly, several open a small list. */
function ReceiptCell({ attachments }: { attachments: AttachmentRef[] }) {
  const { t } = useTranslation('expenses');
  if (attachments.length === 0) return <span className="text-muted-foreground">–</span>;
  if (attachments.length === 1) {
    const a = attachments[0];
    return (
      <a
        href={attachmentUrl(a.id)}
        target="_blank"
        rel="noopener noreferrer"
        title={a.fileName}
        aria-label={t('table.openReceipt', { name: a.fileName })}
        className="inline-flex items-center gap-1 rounded px-1 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden /> 1
      </a>
    );
  }
  return (
    <details>
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1 rounded px-1 text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={t('table.receipts', { count: attachments.length })}
      >
        <Paperclip className="h-3.5 w-3.5" aria-hidden /> {attachments.length}
      </summary>
      <ul className="mt-1 w-44 space-y-0.5 rounded-md border bg-card p-1 shadow-sm">
        {attachments.map((a) => (
          <li key={a.id}>
            <a
              href={attachmentUrl(a.id)}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate rounded px-2 py-1 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {a.fileName}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
