import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, Info, RefreshCcw } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/misc';
import { BalanceCards } from './BalanceCards';
import { HandoverDialog } from './HandoverDialog';
import { HandoversSection } from './HandoversSection';
import { LedgerSection } from './LedgerSection';
import { canHandOver, type BalancesResponse, type HolderBalance } from './types';

/**
 * "Cash & settlements" — the no-escape-point screen: every euro received sits with a
 * holder until it is handed over (normally to the Company Account).
 */
export default function CashPage() {
  const { t } = useTranslation('cash');
  const { user } = useAuth();
  const canWrite = user?.role === 'ADMIN';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [fromHolderId, setFromHolderId] = useState<number | null>(null);

  const balances = useQuery({
    queryKey: ['cash', 'balances'],
    queryFn: () => api.get<BalancesResponse>('/cash/balances'),
  });

  const list = useMemo(() => balances.data?.balances ?? [], [balances.data]);
  const holders = useMemo(() => list.map((b) => b.holder), [list]);
  const givers = useMemo(() => list.filter((b) => canHandOver(b.holder.kind)), [list]);
  const heldOutsideCents = useMemo(
    () => givers.reduce((sum, b) => sum + Math.max(0, b.holdingCents), 0),
    [givers],
  );
  const overdueCount = list.filter((b) => b.overdueAlert).length;
  const company = list.find((b) => b.holder.kind === 'COMPANY');

  const openHandover = (b?: HolderBalance) => {
    setFromHolderId(b ? b.holder.id : null);
    setDialogOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void balances.refetch()}
              disabled={balances.isFetching}
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t('common:action.refresh')}
            </Button>
            {canWrite && givers.length > 0 ? (
              <Button size="sm" onClick={() => openHandover()}>
                <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('actions.recordHandover')}
              </Button>
            ) : null}
          </>
        }
      />

      {/* BALANCES */}
      <section aria-labelledby="cash-balances-heading" className="space-y-3">
        <h2 id="cash-balances-heading" className="text-sm font-semibold">
          {t('balances.title')}
        </h2>

        {balances.isLoading ? (
          <LoadingState label={t('common:common.loading')} />
        ) : balances.isError ? (
          <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />
        ) : list.length === 0 ? (
          <EmptyState title={t('balances.emptyTitle')} hint={t('balances.emptyHint')} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <KpiCard
                label={t('summary.heldOutside')}
                value={fmtEUR(heldOutsideCents)}
                sub={t('summary.heldOutsideSub')}
                tone={heldOutsideCents > 0 ? 'loss' : 'default'}
              />
              <KpiCard
                label={t('summary.overdue')}
                value={String(overdueCount)}
                sub={t('summary.overdueSub', { count: balances.data?.alertAfterDays ?? 0 })}
                tone={overdueCount > 0 ? 'loss' : 'profit'}
              />
              {company ? (
                <KpiCard
                  label={company.holder.name}
                  value={fmtEUR(company.holdingCents)}
                  sub={t('summary.companySub')}
                />
              ) : null}
            </div>

            <BalanceCards
              balances={list}
              alertAfterDays={balances.data?.alertAfterDays ?? 0}
              canWrite={canWrite}
              onHandOver={openHandover}
            />

            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{t('alertNote', { count: balances.data?.alertAfterDays ?? 0 })}</span>
            </p>
          </>
        )}
      </section>

      {/* LEDGER */}
      <section aria-label={t('ledger.title')}>
        <LedgerSection holders={holders} />
      </section>

      {/* HANDOVERS HISTORY */}
      <section aria-label={t('history.title')}>
        <HandoversSection
          canWrite={canWrite}
          onRecord={givers.length > 0 ? () => openHandover() : undefined}
        />
      </section>

      {canWrite && list.length > 0 ? (
        <HandoverDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          balances={list}
          fromHolderId={fromHolderId}
        />
      ) : null}
    </div>
  );
}
