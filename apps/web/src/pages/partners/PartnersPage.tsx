import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCcw } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import { defaultPeriod, type Period, PeriodSelector } from '@/components/PeriodSelector';
import { CollectedCard, HoldingsCard, InvestedCard, WhoPaidCard } from './CapitalSections';
import { PayablesCard, ProfitCard, SalariesCard } from './ProfitSections';
import type { CashBalance, CashBalances, HoldingView, LoadStatus, PartnerSummary } from './types';

/** Partners — PDF Figure 5: capital, who paid for what, cash held, salaries, 50/50 profit split. */
export default function PartnersPage() {
  const { t } = useTranslation('partners');
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [period, setPeriod] = useState<Period>(() => defaultPeriod('year'));

  const periodQs = useMemo(() => qs({ from: period.from, to: period.to }), [period]);

  const summary = useQuery({
    queryKey: ['partners', 'summary', period.from, period.to],
    queryFn: () => api.get<PartnerSummary>('/partners/summary' + periodQs),
    placeholderData: keepPreviousData,
  });
  // settlement dates + overdue flags for the "currently holding" table
  const cash = useQuery({
    queryKey: ['cash', 'balances'],
    queryFn: () => api.get<CashBalances>('/cash/balances'),
    retry: false,
  });

  const cashStatus: LoadStatus = cash.isLoading ? 'loading' : cash.isError && !cash.data ? 'error' : 'ready';

  const holdings = useMemo<HoldingView[]>(() => {
    const rows = summary.data?.holdings ?? [];
    const byId = new Map<number, CashBalance>((cash.data?.balances ?? []).map((b) => [b.holder.id, b] as const));
    return rows.map((h) => {
      const balance = byId.get(h.holder.id);
      return {
        ...h,
        oldestUnsettledDate: balance?.oldestUnsettledDate ?? null,
        overdueAlert: balance?.overdueAlert ?? false,
      };
    });
  }, [summary.data, cash.data]);

  const refreshing = summary.isFetching || cash.isFetching;

  const refresh = async () => {
    const [s] = await Promise.all([summary.refetch(), cash.refetch()]);
    if (s.isError) {
      toast.error(s.error instanceof Error ? s.error.message : t('common:common.errorTitle'));
    } else {
      toast.success(t('refreshed'));
    }
  };

  const data = summary.data;
  const isEmpty =
    !!data &&
    data.invested.length === 0 &&
    data.jointCents === 0 &&
    data.holdings.length === 0 &&
    data.salaries.length === 0 &&
    data.collectedByHolder.every((c) => c.amountCents === 0);

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCcw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
            {t('common:action.refresh')}
          </Button>
        }
      />

      <PeriodSelector value={period} onChange={setPeriod} />
      <p className="text-2xs text-muted-foreground">{t('scopeNote')}</p>

      {summary.isLoading ? <LoadingState label={t('common:common.loading')} /> : null}
      {summary.isError && !data ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}

      {data && isEmpty ? (
        <EmptyState
          title={t('empty.title')}
          hint={t('empty.hint')}
          action={
            isAdmin ? (
              <Link to="/settings" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('empty.openSettings')}
              </Link>
            ) : undefined
          }
        />
      ) : null}

      {data && !isEmpty ? (
        <div
          className={cn('space-y-4 transition-opacity', summary.isPlaceholderData && 'opacity-60')}
          aria-busy={summary.isFetching}
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <InvestedCard invested={data.invested} jointCents={data.jointCents} />
            <WhoPaidCard invested={data.invested} />
          </div>

          <CollectedCard collected={data.collectedByHolder} />

          <div className="grid gap-4 lg:grid-cols-2">
            <HoldingsCard
              rows={holdings}
              cashStatus={cashStatus}
              alertAfterDays={cash.data?.alertAfterDays ?? null}
              canSettle={isAdmin}
              onRetryCash={() => void cash.refetch()}
            />
            <SalariesCard salaries={data.salaries} totalCents={data.profit.salariesCents} canEditSettings={isAdmin} />
          </div>

          <ProfitCard profit={data.profit} />

          <PayablesCard payables={data.payables} />
        </div>
      ) : null}
    </div>
  );
}
