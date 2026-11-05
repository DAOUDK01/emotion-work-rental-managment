import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { HandCoins, Settings } from 'lucide-react';
import { fmtEUR, fmtPct } from '@/lib/format';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { HBars } from '@/components/charts';
import { ScopeBadge } from './CapitalSections';
import type { PayableRow, ProfitBlock, SalaryRow } from './types';

/** SALARIES — monthly rate (as of the period end) and the period total. */
export function SalariesCard({
  salaries,
  totalCents,
  canEditSettings,
}: {
  salaries: SalaryRow[];
  totalCents: number;
  canEditSettings: boolean;
}) {
  const { t } = useTranslation('partners');

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>{t('salaries.title')}</CardTitle>
          <CardDescription>{t('salaries.description')}</CardDescription>
        </div>
        <ScopeBadge scope="period" />
      </CardHeader>
      <CardContent className="space-y-2">
        {salaries.length === 0 ? (
          <EmptyState title={t('salaries.empty')} hint={t('salaries.emptyHint')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH scope="col">{t('salaries.partner')}</TH>
                <TH scope="col" className="text-right">
                  {t('salaries.monthly')}
                </TH>
                <TH scope="col" className="text-right">
                  {t('salaries.periodTotal')}
                </TH>
              </TR>
            </THead>
            <TBody>
              {salaries.map((s) => (
                <TR key={s.holder.id}>
                  <TD className="font-medium">{s.holder.name}</TD>
                  <TDMoney className={s.monthlyCents === 0 ? 'text-muted-foreground' : undefined}>
                    {fmtEUR(s.monthlyCents)}
                  </TDMoney>
                  <TDMoney className={s.periodTotalCents === 0 ? 'text-muted-foreground' : undefined}>
                    {fmtEUR(s.periodTotalCents)}
                  </TDMoney>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={2}>{t('common:common.total')}</TD>
                <TDMoney>{fmtEUR(totalCents)}</TDMoney>
              </TR>
            </TFoot>
          </Table>
        )}
        <p className="flex flex-wrap items-center gap-2 text-2xs text-muted-foreground">
          <span>{t('salaries.hint')}</span>
          {canEditSettings ? (
            <Link
              to="/settings"
              className={cn(buttonVariants({ variant: 'link', size: 'sm' }), 'h-auto px-0 text-2xs')}
            >
              <Settings className="h-3 w-3" aria-hidden="true" />
              {t('salaries.openSettings')}
            </Link>
          ) : null}
        </p>
      </CardContent>
    </Card>
  );
}

/** One big green/red number with a small label. */
function BigFigure({
  label,
  cents,
  sub,
  tone = 'sign',
  size = 'lg',
}: {
  label: string;
  cents: number;
  sub?: string;
  tone?: 'sign' | 'neutral';
  size?: 'lg' | 'xl';
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          'mt-1 font-bold tabular-nums tracking-tight',
          size === 'xl' ? 'text-3xl' : 'text-2xl',
          tone === 'sign' && (cents < 0 ? 'text-loss' : 'text-profit'),
        )}
      >
        {fmtEUR(cents)}
      </div>
      {sub ? <div className="mt-0.5 text-2xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function BreakdownLine({ label, cents, sign, muted }: { label: string; cents: number; sign: '+' | '−'; muted?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-1', muted && 'text-muted-foreground')}>
      <dt>
        <span aria-hidden="true" className="mr-1 inline-block w-3 text-center">
          {sign}
        </span>
        {label}
      </dt>
      <dd className="tabular-nums">{fmtEUR(cents)}</dd>
    </div>
  );
}

/** PROFIT — net profit, − salaries, = after salaries, 50/50 split, tax estimate. */
export function ProfitCard({ profit }: { profit: ProfitBlock }) {
  const { t } = useTranslation('partners');
  const rateDigits = profit.taxRateBp % 100 === 0 ? 0 : 1;
  const rate = fmtPct(profit.taxRateBp / 100, rateDigits);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle>{t('profit.title')}</CardTitle>
          <CardDescription>{t('profit.description')}</CardDescription>
        </div>
        <ScopeBadge scope="period" />
      </CardHeader>
      <CardContent className="space-y-4">
        {/* the bridge: net profit − salaries = after salaries */}
        <div className="grid gap-3 sm:grid-cols-3">
          <BigFigure label={t('profit.netProfit')} cents={profit.netProfitCents} sub={t('profit.beforeSalaries')} />
          <BigFigure label={`− ${t('profit.salaries')}`} cents={profit.salariesCents} tone="neutral" />
          <BigFigure label={`= ${t('profit.afterSalaries')}`} cents={profit.afterSalariesCents} />
        </div>

        <details className="rounded-md border px-3 py-2 text-xs">
          <summary className="cursor-pointer select-none font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t('profit.howCalculated')}
          </summary>
          <dl className="mt-2 divide-y">
            <BreakdownLine label={t('profit.revenueNet')} cents={profit.revenueNetCents} sign="+" />
            <BreakdownLine label={t('profit.expenses')} cents={profit.expensesCents} sign="−" />
            {profit.cogsCents !== 0 ? (
              <BreakdownLine label={t('profit.cogs')} cents={profit.cogsCents} sign="−" />
            ) : null}
            <BreakdownLine
              label={
                profit.unitPurchasesCounted
                  ? t('profit.unitPurchases')
                  : `${t('profit.unitPurchases')} (${t('profit.unitPurchasesExcluded')})`
              }
              cents={profit.unitPurchasesCents}
              sign="−"
              muted={!profit.unitPurchasesCounted}
            />
            <div className="flex items-center justify-between gap-3 py-1 font-semibold">
              <dt>
                <span aria-hidden="true" className="mr-1 inline-block w-3 text-center">
                  =
                </span>
                {t('profit.netProfit')}
              </dt>
              <dd className={cn('tabular-nums', profit.netProfitCents < 0 ? 'text-loss' : 'text-profit')}>
                {fmtEUR(profit.netProfitCents)}
              </dd>
            </div>
          </dl>
        </details>

        {/* 50/50 split */}
        <section aria-labelledby="profit-split-heading" className="space-y-2">
          <h4 id="profit-split-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('profit.split')}
          </h4>
          {profit.split.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('profit.noPartners')}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {profit.split.map((s) => (
                  <BigFigure
                    key={s.holder.id}
                    label={t('profit.shareOf', { name: s.holder.name })}
                    cents={s.shareCents}
                    size="xl"
                  />
                ))}
              </div>
              <HBars
                data={profit.split.map((s) => ({ label: s.holder.name, value: s.shareCents }))}
                colorBy="sign"
                height={Math.max(100, profit.split.length * 44 + 12)}
              />
            </>
          )}
        </section>

        {/* tax */}
        <div className="grid gap-3 sm:grid-cols-2">
          <BigFigure
            label={t('profit.taxEstimate', { rate })}
            cents={profit.taxEstimateCents}
            tone="neutral"
            sub={profit.afterSalariesCents <= 0 ? t('profit.noTaxOnLoss') : undefined}
          />
          <BigFigure label={t('profit.afterTax')} cents={profit.afterTaxCents} />
        </div>
        <p className="text-2xs text-muted-foreground">{t('profit.taxNote')}</p>
      </CardContent>
    </Card>
  );
}

/** PAYABLES — what the company owes each partner for personally-paid purchases. */
export function PayablesCard({ payables }: { payables: PayableRow[] }) {
  const { t } = useTranslation('partners');
  const owed = payables.filter((p) => p.payableCents !== 0);
  if (owed.length === 0) return null;

  return (
    <Card className="border-amber-400/50">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div className="space-y-1">
          <CardTitle className="inline-flex items-center gap-1.5">
            <HandCoins className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
            {t('payables.title')}
          </CardTitle>
          <CardDescription>{t('payables.note')}</CardDescription>
        </div>
        <ScopeBadge scope="allTime" />
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {owed.map((p) => (
            <li key={p.holder.id} className="rounded-md border bg-amber-500/5 px-3 py-2 text-sm font-medium">
              {t('payables.line', { name: p.holder.name, amount: fmtEUR(p.payableCents) })}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
