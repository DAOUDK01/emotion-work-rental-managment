import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, RefreshCcw, TriangleAlert } from 'lucide-react';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { CHART, HBars } from '@/components/charts';
import {
  INVESTMENT_CATEGORIES,
  type CollectedRow,
  type HoldingView,
  type InvestedRow,
  type LoadStatus,
} from './types';

/** "All time" / "Selected period" pill shown in every card header. */
export function ScopeBadge({ scope }: { scope: 'allTime' | 'period' }) {
  const { t } = useTranslation('partners');
  return <Badge variant={scope === 'allTime' ? 'outline' : 'info'}>{t(`scope.${scope}`)}</Badge>;
}

function CardHead({
  title,
  description,
  scope,
}: {
  title: string;
  description?: string;
  scope: 'allTime' | 'period';
}) {
  return (
    <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
      <div className="space-y-1">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </div>
      <ScopeBadge scope={scope} />
    </CardHeader>
  );
}

/** TOTAL INVESTED — horizontal bars per partner + Joint (reinvested). */
export function InvestedCard({ invested, jointCents }: { invested: InvestedRow[]; jointCents: number }) {
  const { t } = useTranslation('partners');
  const totalCents = invested.reduce((acc, r) => acc + r.totalCents, 0) + jointCents;
  const hasData = invested.length > 0 || jointCents !== 0;
  const data = [
    ...invested.map((r) => ({ label: r.holder.name, value: r.totalCents })),
    { label: t('invested.joint'), value: jointCents },
  ];

  return (
    <Card>
      <CardHead
        title={t('invested.title')}
        description={hasData ? t('invested.total', { amount: fmtEUR(totalCents) }) : undefined}
        scope="allTime"
      />
      <CardContent className="space-y-2">
        {hasData ? (
          <>
            <HBars data={data} color={CHART.navy} />
            <p className="text-2xs text-muted-foreground">{t('invested.note')}</p>
          </>
        ) : (
          <EmptyState title={t('invested.empty')} hint={t('invested.emptyHint')} />
        )}
      </CardContent>
    </Card>
  );
}

/** WHO PAID FOR WHAT — category rows × partner columns. */
export function WhoPaidCard({ invested }: { invested: InvestedRow[] }) {
  const { t } = useTranslation('partners');
  const grandTotal = invested.reduce((acc, r) => acc + r.totalCents, 0);

  return (
    <Card>
      <CardHead title={t('whoPaid.title')} description={t('whoPaid.description')} scope="allTime" />
      <CardContent>
        {invested.length === 0 ? (
          <EmptyState title={t('invested.empty')} hint={t('invested.emptyHint')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH scope="col">{t('whoPaid.category')}</TH>
                {invested.map((r) => (
                  <TH key={r.holder.id} scope="col" className="text-right">
                    {r.holder.name}
                  </TH>
                ))}
                <TH scope="col" className="text-right">
                  {t('common:common.total')}
                </TH>
              </TR>
            </THead>
            <TBody>
              {INVESTMENT_CATEGORIES.map((category) => {
                const rowTotal = invested.reduce((acc, r) => acc + r.byCategory[category], 0);
                return (
                  <TR key={category}>
                    <TD className="font-medium">{t(`categories.${category}`)}</TD>
                    {invested.map((r) => {
                      const cents = r.byCategory[category];
                      return (
                        <TDMoney key={r.holder.id} className={cents === 0 ? 'text-muted-foreground' : undefined}>
                          {fmtEUR(cents)}
                        </TDMoney>
                      );
                    })}
                    <TDMoney className={cn('font-medium', rowTotal === 0 && 'text-muted-foreground')}>
                      {fmtEUR(rowTotal)}
                    </TDMoney>
                  </TR>
                );
              })}
            </TBody>
            <TFoot>
              <TR>
                <TD>{t('common:common.total')}</TD>
                {invested.map((r) => (
                  <TDMoney key={r.holder.id}>{fmtEUR(r.totalCents)}</TDMoney>
                ))}
                <TDMoney>{fmtEUR(grandTotal)}</TDMoney>
              </TR>
            </TFoot>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/** CASH COLLECTED BY — one chip per holder (holder → amount). */
export function CollectedCard({ collected }: { collected: CollectedRow[] }) {
  const { t } = useTranslation('partners');
  const anyCollected = collected.some((c) => c.amountCents !== 0);

  return (
    <Card>
      <CardHead title={t('collected.title')} description={t('collected.description')} scope="period" />
      <CardContent>
        {!anyCollected ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('collected.empty')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label={t('collected.title')}>
            {collected.map((c) => (
              <li
                key={c.holder.id}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm',
                  c.amountCents === 0 && 'text-muted-foreground',
                )}
                aria-label={t('collected.chipLabel', { name: c.holder.name, amount: fmtEUR(c.amountCents) })}
              >
                <span className="font-medium">{c.holder.name}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <span className="font-semibold tabular-nums">{fmtEUR(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** CURRENTLY HOLDING — cash not yet handed over, red when held too long. */
export function HoldingsCard({
  rows,
  cashStatus,
  alertAfterDays,
  canSettle,
  onRetryCash,
}: {
  rows: HoldingView[];
  cashStatus: LoadStatus;
  alertAfterDays: number | null;
  canSettle: boolean;
  onRetryCash: () => void;
}) {
  const { t } = useTranslation('partners');

  return (
    <Card>
      <CardHead title={t('holding.title')} description={t('holding.description')} scope="allTime" />
      <CardContent className="space-y-2">
        {cashStatus === 'error' ? (
          <div
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
            role="alert"
          >
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
              {t('holding.datesError')}
            </span>
            <Button variant="outline" size="sm" onClick={onRetryCash}>
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t('common:action.retry')}
            </Button>
          </div>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState title={t('holding.empty')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH scope="col">{t('holding.holder')}</TH>
                <TH scope="col" className="text-right">
                  {t('holding.holding')}
                </TH>
                <TH scope="col">{t('holding.oldest')}</TH>
                <TH scope="col" className="text-right">
                  <span className="sr-only">{t('common:common.actions')}</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r) => {
                const isCompany = r.holder.kind === 'COMPANY';
                const overdueTitle =
                  alertAfterDays !== null ? t('holding.overdueHint', { days: alertAfterDays }) : undefined;
                return (
                  <TR key={r.holder.id} className={r.overdueAlert ? 'bg-loss/5' : undefined}>
                    <TD className="font-medium">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {r.holder.name}
                        {isCompany ? <Badge variant="outline">{t('holding.companyAccount')}</Badge> : null}
                        {r.overdueAlert ? (
                          <Badge variant="danger" title={overdueTitle}>
                            {t('holding.overdue')}
                          </Badge>
                        ) : null}
                      </span>
                    </TD>
                    <TDMoney className={cn('font-semibold', r.overdueAlert && 'text-loss')}>
                      {fmtEUR(r.holdingCents)}
                    </TDMoney>
                    <TD className={cn('tabular-nums', r.overdueAlert ? 'font-medium text-loss' : 'text-muted-foreground')}>
                      {isCompany ? '–' : cashStatus === 'loading' ? '…' : fmtDate(r.oldestUnsettledDate)}
                    </TD>
                    <TD className="text-right">
                      {!isCompany && r.holdingCents > 0 ? (
                        <Link
                          to="/cash"
                          className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto px-0', r.overdueAlert && 'text-loss')}
                          aria-label={t(canSettle ? 'holding.settleAria' : 'holding.viewAria', { name: r.holder.name })}
                        >
                          {t(canSettle ? 'holding.settle' : 'holding.view')}
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </Link>
                      ) : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
        {cashStatus === 'loading' ? (
          <p className="text-2xs text-muted-foreground" aria-live="polite">
            {t('holding.datesLoading')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
