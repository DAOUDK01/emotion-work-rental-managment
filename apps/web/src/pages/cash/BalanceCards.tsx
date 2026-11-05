import { useTranslation } from 'react-i18next';
import { ArrowRightLeft, TriangleAlert } from 'lucide-react';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/components/ui/utils';
import { KindChip } from './CashWidgets';
import { canHandOver, type HolderBalance } from './types';

/** One card per money holder: received / handed over / HOLDING, plus the overdue alert. */
export function BalanceCards({
  balances,
  alertAfterDays,
  canWrite,
  onHandOver,
}: {
  balances: HolderBalance[];
  alertAfterDays: number;
  canWrite: boolean;
  onHandOver: (balance: HolderBalance) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {balances.map((b) => (
        <BalanceCard
          key={b.holder.id}
          balance={b}
          alertAfterDays={alertAfterDays}
          canWrite={canWrite}
          onHandOver={() => onHandOver(b)}
        />
      ))}
    </div>
  );
}

function BalanceCard({
  balance: b,
  alertAfterDays,
  canWrite,
  onHandOver,
}: {
  balance: HolderBalance;
  alertAfterDays: number;
  canWrite: boolean;
  onHandOver: () => void;
}) {
  const { t } = useTranslation('cash');
  const isCompany = b.holder.kind === 'COMPANY';
  const headingId = `cash-holder-${b.holder.id}`;

  return (
    <Card
      className={cn('flex flex-col', b.overdueAlert && 'border-2 border-amber-400 dark:border-amber-500')}
      aria-labelledby={headingId}
      role="region"
    >
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <CardTitle id={headingId} className="text-base">
          {b.holder.name}
        </CardTitle>
        <KindChip kind={b.holder.kind} />
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3">
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">
            {isCompany ? t('balances.receivedInclHandovers') : t('balances.received')}
          </dt>
          <dd className="text-right tabular-nums">{fmtEUR(b.receivedCents)}</dd>
          {!isCompany ? (
            <>
              <dt className="text-muted-foreground">{t('balances.handedOver')}</dt>
              <dd className="text-right tabular-nums">{fmtEUR(b.handedOverCents)}</dd>
            </>
          ) : null}
        </dl>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {isCompany ? t('balances.inAccount') : t('balances.holding')}
          </div>
          <div
            className={cn(
              'text-3xl font-bold tabular-nums tracking-tight',
              b.holdingCents < 0 && 'text-loss',
              b.overdueAlert && 'text-amber-700 dark:text-amber-400',
            )}
          >
            {fmtEUR(b.holdingCents)}
          </div>
        </div>

        {b.overdueAlert ? (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-md border border-amber-400/50 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:text-amber-300"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>
              {t('balances.overdue', { date: fmtDate(b.oldestUnsettledDate), count: alertAfterDays })}
            </span>
          </p>
        ) : !isCompany && b.holdingCents > 0 && b.oldestUnsettledDate ? (
          <p className="text-xs text-muted-foreground">
            {t('balances.unsettledSince', { date: fmtDate(b.oldestUnsettledDate) })}
          </p>
        ) : !isCompany && b.holdingCents < 0 ? (
          <p className="text-xs text-loss">{t('balances.negative')}</p>
        ) : !isCompany && b.receivedCents !== 0 ? (
          <p className="text-xs text-profit">{t('balances.settled')}</p>
        ) : isCompany ? (
          <p className="text-xs text-muted-foreground">{t('balances.companyHint')}</p>
        ) : null}

        {canWrite && canHandOver(b.holder.kind) ? (
          <Button
            className="mt-auto w-full sm:w-auto sm:self-start"
            variant={b.overdueAlert ? 'accent' : 'outline'}
            onClick={onHandOver}
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            {t('balances.handOver')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
