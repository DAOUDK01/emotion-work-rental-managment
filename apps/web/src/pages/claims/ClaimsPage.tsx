import { useCallback, useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, ChevronLeft, ChevronRight, Eye, Paperclip, Pencil, Plus, Search } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { ClaimDetailDrawer } from './ClaimDetailDrawer';
import { ClaimFormDialog } from './ClaimFormDialog';
import { ClaimStatusDialog } from './ClaimStatusDialog';
import { StatusTimeline } from './StatusTimeline';
import { CLAIM_STATUSES, type Claim, type ClaimListResponse, type ClaimStatus } from './types';

const PAGE_SIZE = 50;

export default function ClaimsPage() {
  const { t, i18n } = useTranslation('claims');
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';

  const [status, setStatus] = useState<'' | ClaimStatus>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Claim | null>(null);
  const [statusClaim, setStatusClaim] = useState<Claim | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);

  // debounce the search box
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(1), [q, status]);

  const listQs = useMemo(() => qs({ status: status || undefined, q: q || undefined, page, pageSize: PAGE_SIZE }), [status, q, page]);

  const list = useQuery({
    queryKey: ['claims', 'list', listQs],
    queryFn: () => api.get<ClaimListResponse>('/claims' + listQs),
    placeholderData: keepPreviousData,
  });

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = useCallback((claim: Claim) => {
    setEditing(claim);
    setFormOpen(true);
  }, []);
  const closeForm = useCallback(() => setFormOpen(false), []);
  const closeDetail = useCallback(() => setDetailId(null), []);
  const closeStatus = useCallback(() => setStatusClaim(null), []);

  const productName = (c: Claim) =>
    c.product ? (i18n.language === 'fi' && c.product.nameFi ? c.product.nameFi : c.product.nameEn) : null;

  const total = list.data?.total ?? 0;
  const claims = list.data?.claims ?? [];
  const filtered = q !== '' || status !== '';
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canWrite ? (
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
        <Select
          aria-label={t('filters.status')}
          className="w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value as '' | ClaimStatus)}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {CLAIM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {list.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : claims.length === 0 ? (
        filtered ? (
          <EmptyState title={t('empty.filteredTitle')} hint={t('empty.filteredHint')} />
        ) : (
          <EmptyState
            title={t('empty.title')}
            hint={t('empty.hint')}
            action={
              canWrite ? (
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
                <TH>{t('table.caseNumber')}</TH>
                <TH>{t('table.company')}</TH>
                <TH className="hidden md:table-cell">{t('table.customer')}</TH>
                <TH className="hidden lg:table-cell">{t('table.item')}</TH>
                <TH className="text-right">{t('table.claimed')}</TH>
                <TH className="text-right">{t('table.approved')}</TH>
                <TH>{t('table.status')}</TH>
                <TH className="hidden sm:table-cell">{t('table.dates')}</TH>
                <TH className="text-right">
                  <span className="sr-only">{t('common:common.actions')}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {claims.map((c) => (
                <TR key={c.id}>
                  <TD className="whitespace-nowrap">
                    <button
                      type="button"
                      className="font-mono text-xs font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setDetailId(c.id)}
                    >
                      {c.caseNumber}
                    </button>
                    {c.attachments.length > 0 ? (
                      <span
                        className="ml-1.5 inline-flex items-center gap-0.5 text-2xs text-muted-foreground"
                        title={t('table.documents', { count: c.attachments.length })}
                      >
                        <Paperclip className="h-3 w-3" aria-hidden="true" />
                        {c.attachments.length}
                        <span className="sr-only">{t('table.documents', { count: c.attachments.length })}</span>
                      </span>
                    ) : null}
                  </TD>
                  <TD>
                    <div className="font-medium">{c.company}</div>
                    <div className="line-clamp-1 max-w-[16rem] text-2xs text-muted-foreground" title={c.description}>
                      {c.description}
                    </div>
                  </TD>
                  <TD className="hidden md:table-cell">{c.customer?.name ?? '–'}</TD>
                  <TD className="hidden text-xs lg:table-cell">
                    {c.unit ? <div className="font-medium">{c.unit.code}</div> : null}
                    {c.product ? (
                      <div className="text-muted-foreground">
                        {c.product.sku} — {productName(c)}
                      </div>
                    ) : null}
                    {!c.unit && !c.product ? '–' : null}
                  </TD>
                  <TDMoney className="whitespace-nowrap">{fmtEUR(c.claimedCents)}</TDMoney>
                  <TDMoney className="whitespace-nowrap font-medium">{fmtEUR(c.approvedCents)}</TDMoney>
                  <TD>
                    <StatusTimeline status={c.status} compact />
                  </TD>
                  <TD className="hidden whitespace-nowrap text-2xs text-muted-foreground sm:table-cell">
                    <div>
                      {t('table.opened')}: {fmtDate(c.createdAt)}
                    </div>
                    {c.submittedAt ? (
                      <div>
                        {t('table.submitted')}: {fmtDate(c.submittedAt)}
                      </div>
                    ) : null}
                    {c.decidedAt ? (
                      <div>
                        {t('table.decided')}: {fmtDate(c.decidedAt)}
                      </div>
                    ) : null}
                  </TD>
                  <TD className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={t('actions.view', { caseNumber: c.caseNumber })}
                        title={t('actions.view', { caseNumber: c.caseNumber })}
                        onClick={() => setDetailId(c.id)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canWrite ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={t('actions.edit', { caseNumber: c.caseNumber })}
                            title={t('actions.edit', { caseNumber: c.caseNumber })}
                            onClick={() => openEdit(c)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={t('actions.changeStatusFor', { caseNumber: c.caseNumber })}
                            title={t('actions.changeStatus')}
                            onClick={() => setStatusClaim(c)}
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </TD>
                </TR>
              ))}
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
          ) : (
            <p className="text-xs text-muted-foreground">{t('pagination.count', { count: total })}</p>
          )}
        </>
      )}

      <ClaimFormDialog
        open={formOpen}
        claim={editing}
        onClose={closeForm}
        onSaved={(saved) => {
          if (!editing) setDetailId(saved.id);
        }}
      />
      <ClaimStatusDialog claim={statusClaim} onClose={closeStatus} />
      <ClaimDetailDrawer
        claimId={detailId}
        onClose={closeDetail}
        onEdit={openEdit}
        onChangeStatus={(claim) => setStatusClaim(claim)}
      />
    </div>
  );
}
