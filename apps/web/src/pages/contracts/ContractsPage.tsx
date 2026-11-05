import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ClipboardList, Pencil, Plus, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader, Segmented, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { ContractFormDialog } from './ContractFormDialog';
import { JobLog } from './JobLog';
import type { Contract, ContractListResponse, JobListResponse } from './types';

const PAGE_SIZE = 50;
type ActiveFilter = '' | 'true' | 'false';

export default function ContractsPage() {
  const { t } = useTranslation('contracts');
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState<ActiveFilter>('true');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [selected, setSelected] = useState<Contract | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [q, active]);

  const listQs = useMemo(() => qs({ q: q || undefined, active: active || undefined, page, pageSize: PAGE_SIZE }), [q, active, page]);
  const list = useQuery({
    queryKey: ['contracts', 'list', listQs],
    queryFn: () => api.get<ContractListResponse>('/contracts' + listQs),
    placeholderData: keepPreviousData,
  });
  const contracts = useMemo(() => list.data?.contracts ?? [], [list.data]);

  // uninvoiced job count per contract, derived from each contract's jobs list (total of invoiced=false)
  const uninvoicedCounts = useQueries({
    queries: contracts.map((c) => ({
      queryKey: ['contracts', c.id, 'jobs', 'uninvoiced-count'],
      queryFn: () =>
        api.get<JobListResponse>(`/contracts/${c.id}/jobs` + qs({ invoiced: 'false', pageSize: 1 })),
      staleTime: 30_000,
    })),
  });

  // keep the selected contract fresh after edits / refetches
  const current = selected ? (contracts.find((c) => c.id === selected.id) ?? selected) : null;

  const openContract = (c: Contract) => {
    setSelected(c);
    // let the job log render, then bring it into view (mobile: it sits below the table)
    setTimeout(() => {
      document.getElementById('contract-job-log')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const closeForm = useCallback(() => setFormOpen(false), []);

  const periodText = (c: Contract) =>
    `${fmtDate(c.startDate)} – ${c.endDate ? fmtDate(c.endDate) : t('table.openEnded')}`;

  const total = list.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtered = q !== '' || active !== '';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          isAdmin ? (
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" /> {t('new')}
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('common:action.search')}
          />
        </div>
        <Segmented
          size="sm"
          value={active}
          onChange={setActive}
          options={[
            { value: 'true' as const, label: t('filters.activeOnly') },
            { value: 'false' as const, label: t('filters.inactiveOnly') },
            { value: '' as const, label: t('filters.all') },
          ]}
        />
      </div>

      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : contracts.length === 0 ? (
        filtered ? (
          <EmptyState title={t('empty.filteredTitle')} hint={t('empty.filteredHint')} />
        ) : (
          <EmptyState
            title={t('empty.title')}
            hint={t('empty.hint')}
            action={
              isAdmin ? (
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" /> {t('new')}
                </Button>
              ) : null
            }
          />
        )
      ) : (
        <>
          <Table aria-busy={list.isFetching}>
            <THead>
              <TR>
                <TH>{t('table.company')}</TH>
                <TH>{t('table.name')}</TH>
                <TH className="hidden md:table-cell">{t('table.period')}</TH>
                <TH>{t('table.active')}</TH>
                <TH className="text-right">{t('table.uninvoiced')}</TH>
                <TH className="hidden text-right sm:table-cell">{t('table.jobs')}</TH>
                <TH className="text-right">
                  <span className="sr-only">{t('common:common.actions')}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {contracts.map((c, i) => {
                const count = uninvoicedCounts[i];
                const isSelected = current?.id === c.id;
                return (
                  <TR key={c.id} className={cn(isSelected && 'bg-primary/5 hover:bg-primary/10')}>
                    <TD>
                      <div className="font-medium">{c.customer.name}</div>
                      {c.customer.businessId ? (
                        <div className="text-2xs text-muted-foreground">{c.customer.businessId}</div>
                      ) : null}
                    </TD>
                    <TD>
                      <button
                        type="button"
                        className="text-left font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => openContract(c)}
                        aria-pressed={isSelected}
                      >
                        {c.name}
                      </button>
                      <div className="text-2xs text-muted-foreground md:hidden">{periodText(c)}</div>
                    </TD>
                    <TD className="hidden whitespace-nowrap text-xs md:table-cell">{periodText(c)}</TD>
                    <TD>
                      <Badge variant={c.active ? 'success' : 'default'}>
                        {c.active ? t('badge.active') : t('badge.inactive')}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      {count?.isLoading ? (
                        <Spinner className="ml-auto h-4 w-4" />
                      ) : count?.isError ? (
                        <span className="text-xs text-muted-foreground" title={t('table.countFailed')}>
                          –
                        </span>
                      ) : count?.data ? (
                        count.data.total > 0 ? (
                          <Badge variant="warning">{count.data.total}</Badge>
                        ) : (
                          <span className="tabular-nums text-muted-foreground">0</span>
                        )
                      ) : null}
                    </TD>
                    <TD className="hidden text-right tabular-nums sm:table-cell">{c.jobCount}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          aria-label={t('actions.openLog', { name: c.name })}
                          title={t('actions.openLog', { name: c.name })}
                          onClick={() => openContract(c)}
                        >
                          <ClipboardList className="h-4 w-4" />
                        </Button>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={t('actions.edit', { name: c.name })}
                            title={t('actions.edit', { name: c.name })}
                            onClick={() => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>

          {total > PAGE_SIZE ? (
            <nav className="flex items-center justify-between gap-2 text-xs" aria-label={t('pagination.label')}>
              <span className="text-muted-foreground">
                {t('pagination.showing', {
                  from: (page - 1) * PAGE_SIZE + 1,
                  to: Math.min(page * PAGE_SIZE, total),
                  total,
                })}
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  <ChevronLeft className="h-3.5 w-3.5" /> {t('pagination.prev')}
                </Button>
                <span className="tabular-nums">
                  {t('common:common.page')} {page} {t('common:common.of')} {lastPage}
                </span>
                <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
                  {t('pagination.next')} <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </nav>
          ) : null}
          {!current ? <p className="text-xs text-muted-foreground">{t('selectHint')}</p> : null}
        </>
      )}

      {current ? (
        <JobLog
          key={current.id}
          contract={current}
          canWrite={isAdmin}
          periodText={periodText(current)}
          onClose={() => setSelected(null)}
        />
      ) : null}

      <ContractFormDialog
        open={formOpen}
        contract={editing}
        onClose={closeForm}
        onSaved={(saved) => {
          if (!editing) openContract(saved);
          else if (selected?.id === saved.id) setSelected(saved);
        }}
      />
    </div>
  );
}
