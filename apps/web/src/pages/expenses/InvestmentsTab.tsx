import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Ban, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { ApiError, api, qs } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { InvestmentFormDialog } from './InvestmentFormDialog';
import { VoidReasonDialog } from './VoidReasonDialog';
import {
  INVESTMENT_CATEGORIES,
  PAGE_SIZE,
  errorMessage,
  type InvestmentCategory,
  type InvestmentList,
  type InvestmentRow,
  type Lookups,
} from './types';

/** Owner chip selection: everyone, one partner, or the joint 50/50 pot. */
type OwnerFilter = { kind: 'all' } | { kind: 'holder'; id: number } | { kind: 'joint' };

/** INVESTMENTS tab — partner/joint ledger with sums chips, manual add, void (manual rows only). */
export function InvestmentsTab({
  lookups,
  canWrite,
  createSignal,
}: {
  lookups: Lookups;
  canWrite: boolean;
  createSignal: number;
}) {
  const { t } = useTranslation('expenses');
  const queryClient = useQueryClient();
  const partners = useMemo(() => lookups.holders.filter((h) => h.kind === 'PARTNER'), [lookups.holders]);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState<InvestmentCategory | ''>('');
  const [owner, setOwner] = useState<OwnerFilter>({ kind: 'all' });
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<InvestmentRow | null>(null);

  const seenSignal = useRef(createSignal);
  useEffect(() => {
    if (createSignal !== seenSignal.current) {
      seenSignal.current = createSignal;
      setAdding(true);
    }
  }, [createSignal]);

  // sums for the chips ignore the owner selection so every chip keeps its total
  const baseQs = useMemo(
    () => qs({ from: from || undefined, to: to || undefined, category: category || undefined }),
    [from, to, category],
  );
  const ownerQs = owner.kind === 'holder' ? `holderId=${owner.id}` : owner.kind === 'joint' ? 'isJoint=true' : '';
  useEffect(() => setPage(1), [baseQs, ownerQs]);

  const join = (base: string, extra: string) => (extra ? base + (base ? '&' : '?') + extra : base);
  const listQs = join(join(baseQs, ownerQs), `page=${page}&pageSize=${PAGE_SIZE}`);

  const sums = useQuery({
    queryKey: ['investments', 'sums', baseQs],
    queryFn: () => api.get<InvestmentList>('/investments' + join(baseQs, 'pageSize=1')),
  });
  const list = useQuery({
    queryKey: ['investments', 'list', listQs],
    queryFn: () => api.get<InvestmentList>('/investments' + listQs),
    placeholderData: (prev) => prev,
  });

  const voidInvestment = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => api.post<unknown>(`/investments/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success(t('common:common.voidedOk'));
      setVoiding(null);
      for (const key of ['investments', 'partners', 'dashboard']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409 && err.code === 'AUTO_ROW') {
        toast.error(t('investments.autoRowError'));
        setVoiding(null);
      } else {
        toast.error(errorMessage(err, t('common:common.errorTitle')));
      }
    },
  });

  const hasFilters = Boolean(from || to || category || owner.kind !== 'all');
  const clearFilters = () => {
    setFrom('');
    setTo('');
    setCategory('');
    setOwner({ kind: 'all' });
  };

  const sumData = sums.data?.sums;
  const grandTotal = sumData ? sumData.byHolder.reduce((s, h) => s + h.totalCents, 0) + sumData.jointCents : 0;
  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  const chip = (key: string, label: string, amount: number, selected: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted',
      )}
    >
      <span>{label}</span>
      <span className="tabular-nums font-semibold">{fmtEUR(amount)}</span>
    </button>
  );

  const ownerName = (r: InvestmentRow) => (r.isJoint ? t('investments.jointLabel') : (r.holder?.name ?? '–'));
  const linkedText = (r: InvestmentRow) => {
    const parts: string[] = [];
    if (r.expense) {
      parts.push(
        t('investments.linkedExpense', {
          id: r.expense.id,
          description: r.expense.description,
          vendor: r.expense.vendor ? ` · ${r.expense.vendor}` : '',
        }),
      );
    }
    if (r.unit) parts.push(t('investments.linkedUnit', { code: r.unit.code, brand: r.unit.brand }));
    return parts.length > 0 ? parts.join(' · ') : '–';
  };

  return (
    <div className="space-y-4">
      {/* filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="inv-from">{t('common:period.from')}</Label>
          <Input id="inv-from" type="date" className="h-9 w-40" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-to">{t('common:period.to')}</Label>
          <Input id="inv-to" type="date" className="h-9 w-40" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inv-category">{t('investments.category')}</Label>
          <Select
            id="inv-category"
            className="w-48"
            value={category}
            onChange={(e) => setCategory(e.target.value as InvestmentCategory | '')}
          >
            <option value="">{t('filters.allCategories')}</option>
            {INVESTMENT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`investmentCategory.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        {hasFilters ? (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="mb-0.5">
            <X className="h-3.5 w-3.5" /> {t('filters.clear')}
          </Button>
        ) : null}
      </div>

      {/* sums by holder + joint (click to filter) */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-muted-foreground">{t('investments.sumsTitle')}</h3>
        {sums.isLoading ? (
          <p className="text-xs text-muted-foreground">{t('common:common.loading')}</p>
        ) : sums.isError ? (
          <p className="flex flex-wrap items-center gap-2 text-xs text-destructive" role="alert">
            {errorMessage(sums.error, t('common:common.errorTitle'))}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void sums.refetch()}>
              {t('common:action.retry')}
            </Button>
          </p>
        ) : sumData ? (
          <div className="flex flex-wrap gap-2">
            {chip('all', t('investments.allOwners'), grandTotal, owner.kind === 'all', () => setOwner({ kind: 'all' }))}
            {sumData.byHolder.map((h) =>
              chip(
                `h-${h.holder.id}`,
                h.holder.name,
                h.totalCents,
                owner.kind === 'holder' && owner.id === h.holder.id,
                () => setOwner({ kind: 'holder', id: h.holder.id }),
              ),
            )}
            {chip('joint', t('investments.jointLabel'), sumData.jointCents, owner.kind === 'joint', () => setOwner({ kind: 'joint' }))}
          </div>
        ) : null}
      </div>

      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : data && data.investments.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title={t('investments.emptyFiltered')}
            hint={t('empty.filteredHint')}
            action={
              <Button variant="outline" size="sm" onClick={clearFilters}>
                {t('filters.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            title={t('investments.emptyTitle')}
            hint={t('investments.emptyHint')}
            action={
              canWrite ? (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="h-3.5 w-3.5" /> {t('actions.addInvestment')}
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
                <TH>{t('investments.partner')}</TH>
                <TH>{t('investments.category')}</TH>
                <TH className="text-right">{t('columns.amount')}</TH>
                <TH>{t('investments.linked')}</TH>
                <TH>{t('investments.origin')}</TH>
                <TH>{t('investments.note')}</TH>
                {canWrite ? <TH className="text-right">{t('common:common.actions')}</TH> : null}
              </TR>
            </THead>
            <TBody>
              {data.investments.map((r) => {
                const isVoid = r.status === 'VOID';
                return (
                  <TR key={r.id} className={cn(isVoid && 'text-muted-foreground')}>
                    <TD className="whitespace-nowrap">{fmtDate(r.date)}</TD>
                    <TD className="whitespace-nowrap font-medium">{ownerName(r)}</TD>
                    <TD className="whitespace-nowrap">{t(`investmentCategory.${r.category}`)}</TD>
                    <TDMoney className={cn(isVoid && 'line-through')}>{fmtEUR(r.amountCents)}</TDMoney>
                    <TD className="min-w-[12rem] text-xs">{linkedText(r)}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {r.auto ? (
                          <Badge variant="info" title={t('investments.autoTitle')}>
                            {t('investments.auto')}
                          </Badge>
                        ) : (
                          <Badge variant="outline">{t('investments.manual')}</Badge>
                        )}
                        {isVoid ? <Badge variant="danger">{t('common:status.VOID')}</Badge> : null}
                      </div>
                    </TD>
                    <TD className="max-w-[16rem] truncate text-xs" title={r.note ?? undefined}>
                      {r.note ?? '–'}
                    </TD>
                    {canWrite ? (
                      <TD className="text-right">
                        {!r.auto && !isVoid ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setVoiding(r)}
                            aria-label={t('investments.voidOne', { who: ownerName(r), amount: fmtEUR(r.amountCents) })}
                            title={t('common:action.void')}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
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
          <p className="text-2xs text-muted-foreground">{t('investments.autoExplain')}</p>
        </>
      ) : null}

      {adding ? <InvestmentFormDialog partners={partners} onClose={() => setAdding(false)} /> : null}

      <VoidReasonDialog
        open={voiding !== null}
        title={t('void.investmentTitle')}
        message={
          voiding
            ? t('void.investmentMessage', {
                who: ownerName(voiding),
                amount: fmtEUR(voiding.amountCents),
                date: fmtDate(voiding.date),
              })
            : ''
        }
        busy={voidInvestment.isPending}
        onClose={() => setVoiding(null)}
        onConfirm={(reason) => voiding && voidInvestment.mutate({ id: voiding.id, reason })}
      />
    </div>
  );
}
