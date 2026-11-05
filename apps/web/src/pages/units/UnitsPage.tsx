import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtEUR, fmtNumber, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/card';
import { Checkbox, Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import UnitsCompare from './UnitsCompare';
import UnitDetailDrawer from './UnitDetailDrawer';
import UnitFormDialog from './UnitFormDialog';
import UnitSellDialog from './UnitSellDialog';
import {
  UNIT_CATEGORIES,
  UNIT_STATUSES,
  statusBadgeVariant,
  type CompareRow,
  type Unit,
  type UnitCategory,
  type UnitListResponse,
  type UnitStatus,
  type UnitsLookups,
} from './types';

const PAGE_SIZE = 100;

export default function UnitsPage() {
  const { t } = useTranslation('units');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const [view, setView] = useState<'list' | 'compare'>('list');
  const [status, setStatus] = useState<'' | UnitStatus>('');
  const [category, setCategory] = useState<'' | UnitCategory>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [needsReviewOnly, setNeedsReviewOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [detailId, setDetailId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Unit | null>(null);
  const [selling, setSelling] = useState<Unit | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const filtersQs = useMemo(
    () =>
      qs({
        status: status || undefined,
        category: category || undefined,
        q: q || undefined,
        includeInactive: includeInactive ? 'true' : undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    [status, category, q, includeInactive, page],
  );

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<UnitsLookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
  const list = useQuery({
    queryKey: ['units', 'list', filtersQs],
    queryFn: () => api.get<UnitListResponse>('/units' + filtersQs),
  });
  const compare = useQuery({
    queryKey: ['units', 'compare'],
    queryFn: () => api.get<{ byCategory: CompareRow[] }>('/units/compare'),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, next }: { id: number; next: UnitStatus }) =>
      api.put<{ unit: Unit }>(`/units/${id}`, { status: next }),
    onSuccess: () => {
      toast.success(t('actions.statusChanged'));
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const units = list.data?.units ?? [];
  const rows = needsReviewOnly ? units.filter((u) => u.needsReview) : units;
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = status !== '' || category !== '' || q !== '' || needsReviewOnly || includeInactive;

  // KPI mini-cards: fleet by status from the list, money totals from /units/compare.
  const statusCounts = useMemo(() => {
    const counts = new Map<UnitStatus, number>();
    for (const u of units) counts.set(u.status, (counts.get(u.status) ?? 0) + 1);
    return UNIT_STATUSES.filter((s) => counts.has(s))
      .map((s) => `${counts.get(s)!} ${t(`status.${s}`)}`)
      .join(' · ');
  }, [units, t]);
  const compareTotals = useMemo(() => {
    const rows = compare.data?.byCategory ?? [];
    const costCents = rows.reduce((sum, r) => sum + r.costCents, 0);
    const earnedCents = rows.reduce((sum, r) => sum + r.earnedCents, 0);
    return {
      costCents,
      earnedCents,
      paybackPct: costCents > 0 ? Math.round((earnedCents / costCents) * 100) : null,
    };
  }, [compare.data]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (unit: Unit) => {
    setEditing(unit);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canWrite ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t('actions.addUnit')}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: 'list' as const, label: t('view.list') },
            { value: 'compare' as const, label: t('view.compare') },
          ]}
        />
      </div>

      {/* KPI mini-cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label={t('kpi.fleet')} value={fmtNumber(total)} sub={statusCounts || undefined} />
        <KpiCard label={t('kpi.invested')} value={fmtEUR(compareTotals.costCents)} sub={t('kpi.allUnits')} />
        <KpiCard label={t('kpi.earned')} value={fmtEUR(compareTotals.earnedCents)} sub={t('kpi.netOfVat')} />
        <KpiCard
          label={t('kpi.payback')}
          value={compareTotals.paybackPct === null ? '–' : fmtPct(compareTotals.paybackPct)}
          sub={t('kpi.earnedVsCost')}
          tone={compareTotals.paybackPct !== null && compareTotals.paybackPct >= 100 ? 'profit' : 'default'}
        />
      </div>

      {view === 'compare' ? (
        <UnitsCompare query={compare} />
      ) : (
        <>
          {/* filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="search"
              className="h-8 w-56 text-xs"
              placeholder={t('filters.searchPlaceholder')}
              aria-label={t('common:action.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Select
              aria-label={t('filters.status')}
              className="h-8 w-40 text-xs"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as '' | UnitStatus);
                setPage(1);
              }}
            >
              <option value="">{t('filters.allStatuses')}</option>
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('table.category')}
              className="h-8 w-40 text-xs"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as '' | UnitCategory);
                setPage(1);
              }}
            >
              <option value="">{t('filters.allCategories')}</option>
              {UNIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </Select>
            <Checkbox
              label={t('filters.includeInactive')}
              checked={includeInactive}
              onChange={(e) => {
                setIncludeInactive(e.target.checked);
                setPage(1);
              }}
            />
            <Checkbox
              label={t('filters.needsReviewOnly')}
              checked={needsReviewOnly}
              onChange={(e) => setNeedsReviewOnly(e.target.checked)}
            />
          </div>

          {list.isLoading ? <LoadingState /> : null}
          {list.isError ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
          {list.data && rows.length === 0 ? (
            <EmptyState
              title={hasFilters ? t('empty.filtered') : t('empty.title')}
              hint={hasFilters ? undefined : t('empty.hint')}
              action={
                canWrite && !hasFilters ? (
                  <Button onClick={openCreate}>
                    <Plus className="h-4 w-4" /> {t('actions.addUnit')}
                  </Button>
                ) : undefined
              }
            />
          ) : null}

          {rows.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>{t('table.code')}</TH>
                  <TH>{t('table.brand')}</TH>
                  <TH>{t('table.category')}</TH>
                  <TH>{t('table.owner')}</TH>
                  <TH>{t('common:common.status')}</TH>
                  <TH className="text-right">{t('table.cost')}</TH>
                  <TH className="text-right">{t('table.earned')}</TH>
                  <TH className="text-right">{t('table.payback')}</TH>
                  <TH className="text-right">{t('table.saleResult')}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((u) => (
                  <TR
                    key={u.id}
                    tabIndex={0}
                    className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                    onClick={() => setDetailId(u.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setDetailId(u.id);
                      }
                    }}
                    aria-label={u.code}
                  >
                    <TD>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{u.code}</span>
                        {u.needsReview ? (
                          <Badge variant="warning" title={u.reviewReason ?? undefined}>
                            {t('common:common.needsReview')}
                          </Badge>
                        ) : null}
                        {!u.active ? <Badge variant="danger">{t('detail.archived')}</Badge> : null}
                      </div>
                      {u.legacyName ? (
                        <span className="block text-2xs text-muted-foreground">{u.legacyName}</span>
                      ) : null}
                    </TD>
                    <TD>
                      {u.brand}
                      {u.modelName ? <span className="text-muted-foreground"> {u.modelName}</span> : null}
                    </TD>
                    <TD>{t(`category.${u.category}`)}</TD>
                    <TD>{u.owner?.name ?? '–'}</TD>
                    <TD onClick={(e) => e.stopPropagation()}>
                      {canWrite && u.active && u.status !== 'SOLD' ? (
                        <Select
                          aria-label={`${t('common:common.status')} ${u.code}`}
                          className="h-7 w-32 px-1.5 text-xs"
                          value={u.status}
                          disabled={statusMutation.isPending}
                          onChange={(e) =>
                            statusMutation.mutate({ id: u.id, next: e.target.value as UnitStatus })
                          }
                        >
                          {UNIT_STATUSES.filter((s) => s !== 'SOLD').map((s) => (
                            <option key={s} value={s}>
                              {t(`status.${s}`)}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Badge variant={statusBadgeVariant(u.status)}>{t(`status.${u.status}`)}</Badge>
                      )}
                    </TD>
                    <TDMoney>{fmtEUR(u.purchaseCents)}</TDMoney>
                    <TDMoney>{fmtEUR(u.earnedCents)}</TDMoney>
                    <TD className="text-right">
                      {u.paidBack ? (
                        <Badge variant="success">{t('table.paidBack')}</Badge>
                      ) : u.paybackPct === null ? (
                        '–'
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <div className="h-2 w-20 overflow-hidden rounded bg-muted">
                            <div
                              className="h-full rounded bg-navy"
                              style={{ width: `${Math.min(100, u.paybackPct)}%` }}
                            />
                          </div>
                          <span className="tabular-nums text-xs">{fmtPct(u.paybackPct)}</span>
                        </div>
                      )}
                    </TD>
                    <TDMoney>
                      {u.status === 'SOLD' && u.saleProfitCents !== null ? (
                        <span className={u.saleProfitCents < 0 ? 'font-medium text-loss' : 'font-medium text-profit'}>
                          {fmtEUR(u.saleProfitCents, { sign: true })}
                        </span>
                      ) : (
                        '–'
                      )}
                    </TDMoney>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : null}

          {total > PAGE_SIZE ? (
            <div className="flex items-center justify-end gap-2 text-xs">
              <span className="text-muted-foreground">
                {t('common:common.page')} {page} {t('common:common.of')} {pageCount}
              </span>
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                {t('common:action.back')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('common:action.next')}
              </Button>
            </div>
          ) : null}
        </>
      )}

      <UnitDetailDrawer
        unitId={detailId}
        onClose={() => setDetailId(null)}
        onEdit={openEdit}
        onSell={(u) => setSelling(u)}
      />
      <UnitFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        unit={editing}
        lookups={lookups.data}
      />
      <UnitSellDialog
        open={selling !== null}
        onClose={() => setSelling(null)}
        unit={selling}
        lookups={lookups.data}
      />
    </div>
  );
}
