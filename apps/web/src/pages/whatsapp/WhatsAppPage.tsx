import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MessageSquarePlus, RefreshCcw, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { EmptyState, ErrorState, LoadingState, PageHeader, Segmented } from '@/components/ui/misc';
import { InboxTable } from './InboxTable';
import { RejectDialog, ReparseDialog } from './RowDialogs';
import { FormatHelpCard, SetupChecklist } from './SetupGuide';
import { SimulateDialog } from './SimulateDialog';
import { FILTER_STATUSES, PAGE_SIZE, type FilterStatus, type InboxResponse, type WaMessage } from './types';

export default function WhatsAppPage() {
  const { t } = useTranslation('whatsapp');
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [status, setStatus] = useState<FilterStatus>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [simulateOpen, setSimulateOpen] = useState(false);
  const [rejecting, setRejecting] = useState<WaMessage | null>(null);
  const [reparsing, setReparsing] = useState<WaMessage | null>(null);

  // Any filter change starts again from the first page.
  useEffect(() => {
    setPage(1);
  }, [status, from, to]);

  const filterQs = useMemo(
    () => qs({ status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: PAGE_SIZE }),
    [status, from, to, page],
  );
  const filtersActive = status !== '' || from !== '' || to !== '';

  const inbox = useQuery({
    queryKey: ['whatsapp', 'inbox', filterQs],
    queryFn: () => api.get<InboxResponse>('/whatsapp/inbox' + filterQs),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  const total = inbox.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(total, page * PAGE_SIZE);

  // Rejecting rows under a status filter can shrink the list below the current page.
  useEffect(() => {
    if (inbox.data && page > pageCount) setPage(pageCount);
  }, [inbox.data, page, pageCount]);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void inbox.refetch()} disabled={inbox.isFetching}>
              <RefreshCcw className={inbox.isFetching ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} aria-hidden="true" />
              {t('common:action.refresh')}
            </Button>
            {isAdmin ? (
              <Button size="sm" onClick={() => setSimulateOpen(true)}>
                <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" /> {t('actions.simulate')}
              </Button>
            ) : null}
          </>
        }
      />

      {/* filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <span className="block text-xs font-medium text-foreground/90" id="wa-status-filter">
            {t('filters.status')}
          </span>
          <div aria-labelledby="wa-status-filter">
            <Segmented
              size="sm"
              value={status}
              onChange={setStatus}
              options={[
                { value: '' as const, label: t('common:common.all') },
                ...FILTER_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
              ]}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="wa-from">{t('common:period.from')}</Label>
            <Input
              id="wa-from"
              type="date"
              className="h-8 w-40"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="wa-to">{t('common:period.to')}</Label>
            <Input
              id="wa-to"
              type="date"
              className="h-8 w-40"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus('');
                setFrom('');
                setTo('');
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" /> {t('filters.clear')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* inbox */}
      {inbox.isLoading ? (
        <LoadingState label={t('common:common.loading')} />
      ) : inbox.isError ? (
        <ErrorState error={inbox.error} onRetry={() => void inbox.refetch()} />
      ) : inbox.data && inbox.data.messages.length === 0 ? (
        filtersActive ? (
          <EmptyState
            title={t('empty.filteredTitle')}
            hint={t('empty.filteredHint')}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatus('');
                  setFrom('');
                  setTo('');
                }}
              >
                {t('filters.clear')}
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            <EmptyState
              title={t('empty.title')}
              hint={t('empty.hint')}
              action={
                isAdmin ? (
                  <Button size="sm" onClick={() => setSimulateOpen(true)}>
                    <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" /> {t('actions.simulate')}
                  </Button>
                ) : undefined
              }
            />
            <SetupChecklist onSimulate={() => setSimulateOpen(true)} />
          </div>
        )
      ) : inbox.data ? (
        <div className="space-y-2">
          <InboxTable
            messages={inbox.data.messages}
            canAct={isAdmin}
            onReject={setRejecting}
            onReparse={setReparsing}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="tabular-nums">
              {t('table.showing', { from: fmtNumber(firstShown), to: fmtNumber(lastShown), total: fmtNumber(total) })}
            </span>
            {total > PAGE_SIZE ? (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || inbox.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  {t('common:action.back')}
                </Button>
                <span className="tabular-nums">
                  {t('common:common.page')} {page} {t('common:common.of')} {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount || inbox.isFetching}
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                >
                  {t('common:action.next')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <FormatHelpCard />

      <SimulateDialog open={simulateOpen} onClose={() => setSimulateOpen(false)} />
      <RejectDialog message={rejecting} onClose={() => setRejecting(null)} />
      <ReparseDialog message={reparsing} onClose={() => setReparsing(null)} />
    </div>
  );
}
