import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, CircleAlert, Info, PhoneOff, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtEUR, fmtNumber } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, KpiCard } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { fmtDateTime, type ImportIssue, type ImportSummary, type ImportTotals } from './shared';

interface BatchDetail {
  batch: {
    id: number;
    fileName: string;
    importedAt: string;
    summary: ImportSummary | null;
    issues: ImportIssue[] | null;
  };
  needsReview: {
    units: Array<{ id: number; code: string; brand: string; reviewReason: string | null }>;
    entries: Array<{ id: number; entryDate: string; description: string | null; grossCents: number; reviewReason: string | null }>;
    expenses: Array<{ id: number; description: string; vendor: string | null; grossCents: number | null; reviewReason: string | null }>;
  };
}

const SEVERITIES: Array<ImportIssue['severity']> = ['review', 'warning', 'info'];

const COUNT_KEYS = ['units', 'rentals', 'salesEntries', 'expenses', 'customers', 'investments', 'needsReview'] as const;

const TOTAL_KEYS: Array<keyof ImportTotals> = [
  'rentalBilledCents',
  'rentalReceivedCents',
  'salesRevenueCents',
  'totalRevenueCents',
  'toolsCents',
  'sparePartsCents',
  'otherExpensesCents',
  'unitPurchasesCents',
];

const fixLinkClass = 'font-medium text-primary underline-offset-4 hover:underline';

export default function ImportReportPage() {
  const { t } = useTranslation('settings');
  const { batchId } = useParams<{ batchId: string }>();
  const id = Number(batchId);
  const validId = Number.isInteger(id) && id > 0;

  const q = useQuery({
    queryKey: ['import', 'batch', id],
    queryFn: () => api.get<BatchDetail>(`/import/batches/${id}`),
    enabled: validId,
  });

  const backLink = (
    <Link to="/settings?tab=import" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
      <ArrowLeft className="h-3.5 w-3.5" /> {t('report.back')}
    </Link>
  );

  if (!validId) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <PageHeader title={t('report.title')} actions={backLink} />
        <EmptyState title={t('report.notFound')} hint={t('report.notFoundHint')} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('report.title')}
        description={q.data ? `${q.data.batch.fileName} · ${fmtDateTime(q.data.batch.importedAt)}` : undefined}
        actions={backLink}
      />
      {q.isLoading ? <LoadingState /> : null}
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {q.data ? <ReportBody data={q.data} /> : null}
    </div>
  );
}

function ReportBody({ data }: { data: BatchDetail }) {
  const { t } = useTranslation('settings');
  const summary = data.batch.summary ?? {};
  const issues = data.batch.issues ?? [];
  const totals = summary.totals ?? {};
  const hasCounts = COUNT_KEYS.some((k) => summary[k] !== undefined);
  const hasTotals = TOTAL_KEYS.some((k) => totals[k] !== undefined);
  const nr = data.needsReview;

  return (
    <>
      {/* summary counts */}
      {hasCounts ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
          {COUNT_KEYS.map((k) => (
            <KpiCard
              key={k}
              label={t(`import.counts.${k}`)}
              value={summary[k] === undefined ? '–' : fmtNumber(summary[k] ?? 0)}
              tone={k === 'needsReview' && (summary[k] ?? 0) > 0 ? 'loss' : 'default'}
            />
          ))}
        </div>
      ) : (
        <EmptyState title={t('report.noSummary')} hint={t('report.noSummaryHint')} />
      )}

      {/* reconciliation totals */}
      {hasTotals ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('report.totalsTitle')}</CardTitle>
            <CardDescription>{t('report.totalsHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TOTAL_KEYS.map((k) => (
                <div
                  key={k}
                  className={
                    k === 'totalRevenueCents' ? 'rounded-md border border-navy/30 bg-navy/5 p-3' : 'rounded-md border p-3'
                  }
                >
                  <dt className="text-xs text-muted-foreground">{t(`report.totals.${k}`)}</dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums">{fmtEUR(totals[k] ?? null)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <PhoneDecisionCard batchId={data.batch.id} />

      <IssuesCard issues={issues} />

      {/* needs review: units */}
      <Card>
        <CardHeader>
          <CardTitle>{t('report.unitsTitle', { count: nr.units.length })}</CardTitle>
          <CardDescription>
            {t('report.unitsHint')}{' '}
            <Link to="/units" className={fixLinkClass}>
              {t('report.openUnits')}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nr.units.length === 0 ? (
            <EmptyState title={t('report.nothingToReview')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('report.code')}</TH>
                  <TH>{t('report.brand')}</TH>
                  <TH>{t('report.reason')}</TH>
                  <TH className="text-right">{t('report.fixIn')}</TH>
                </TR>
              </THead>
              <TBody>
                {nr.units.map((u) => (
                  <TR key={u.id}>
                    <TD className="font-mono text-xs font-semibold">{u.code}</TD>
                    <TD>{u.brand}</TD>
                    <TD>
                      <ReviewReason reason={u.reviewReason} />
                    </TD>
                    <TD className="text-right">
                      <Link to="/units" className={fixLinkClass}>
                        {t('report.fixUnits')}
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* needs review: entries */}
      <Card>
        <CardHeader>
          <CardTitle>{t('report.entriesTitle', { count: nr.entries.length })}</CardTitle>
          <CardDescription>
            {t('report.entriesHint')}{' '}
            <Link to="/rentals" className={fixLinkClass}>
              {t('report.openRentals')}
            </Link>
            {' · '}
            <Link to="/entry" className={fixLinkClass}>
              {t('report.openEntry')}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nr.entries.length === 0 ? (
            <EmptyState title={t('report.nothingToReview')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('common:common.date')}</TH>
                  <TH>{t('report.description')}</TH>
                  <TH className="text-right">{t('common:money.gross')}</TH>
                  <TH>{t('report.reason')}</TH>
                  <TH className="text-right">{t('report.fixIn')}</TH>
                </TR>
              </THead>
              <TBody>
                {nr.entries.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap">{fmtDate(e.entryDate)}</TD>
                    <TD className="max-w-[16rem] truncate" title={e.description ?? undefined}>
                      {e.description || '–'}
                    </TD>
                    <TDMoney>{fmtEUR(e.grossCents)}</TDMoney>
                    <TD>
                      <ReviewReason reason={e.reviewReason} />
                    </TD>
                    <TD className="whitespace-nowrap text-right">
                      <Link to="/rentals" className={fixLinkClass}>
                        {t('report.fixRentals')}
                      </Link>
                      {' / '}
                      <Link to="/entry" className={fixLinkClass}>
                        {t('report.fixEntry')}
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* needs review: expenses */}
      <Card>
        <CardHeader>
          <CardTitle>{t('report.expensesTitle', { count: nr.expenses.length })}</CardTitle>
          <CardDescription>
            {t('report.expensesHint')}{' '}
            <Link to="/expenses" className={fixLinkClass}>
              {t('report.openExpenses')}
            </Link>
          </CardDescription>
        </CardHeader>
        <CardContent>
          {nr.expenses.length === 0 ? (
            <EmptyState title={t('report.nothingToReview')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('report.description')}</TH>
                  <TH>{t('report.vendor')}</TH>
                  <TH className="text-right">{t('common:money.gross')}</TH>
                  <TH>{t('report.reason')}</TH>
                  <TH className="text-right">{t('report.fixIn')}</TH>
                </TR>
              </THead>
              <TBody>
                {nr.expenses.map((x) => (
                  <TR key={x.id}>
                    <TD className="max-w-[16rem] truncate" title={x.description}>
                      {x.description || '–'}
                    </TD>
                    <TD>{x.vendor || '–'}</TD>
                    <TDMoney>{fmtEUR(x.grossCents)}</TDMoney>
                    <TD>
                      <ReviewReason reason={x.reviewReason} />
                    </TD>
                    <TD className="text-right">
                      <Link to="/expenses" className={fixLinkClass}>
                        {t('report.fixExpenses')}
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function ReviewReason({ reason }: { reason: string | null }) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex flex-col items-start gap-1">
      <Badge variant="warning" title={reason ?? undefined}>
        {t('common:common.needsReview')}
      </Badge>
      {reason ? <span className="text-xs text-muted-foreground">{reason}</span> : null}
    </div>
  );
}

function IssuesCard({ issues }: { issues: ImportIssue[] }) {
  const { t } = useTranslation('settings');
  const groups = useMemo(
    () => SEVERITIES.map((s) => ({ severity: s, items: issues.filter((i) => i.severity === s) })),
    [issues],
  );

  const style: Record<ImportIssue['severity'], { box: string; icon: React.ReactNode; badge: 'warning' | 'danger' | 'default' }> = {
    review: {
      box: 'border-amber-400/50 bg-amber-500/5',
      icon: <TriangleAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden />,
      badge: 'warning',
    },
    warning: {
      box: 'border-loss/30 bg-loss/5',
      icon: <CircleAlert className="h-4 w-4 text-loss" aria-hidden />,
      badge: 'danger',
    },
    info: {
      box: 'bg-muted/30',
      icon: <Info className="h-4 w-4 text-muted-foreground" aria-hidden />,
      badge: 'default',
    },
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('report.issuesTitle', { count: issues.length })}</CardTitle>
        <CardDescription>{t('report.issuesHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {issues.length === 0 ? (
          <EmptyState title={t('report.noIssues')} />
        ) : (
          groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <section key={g.severity} aria-labelledby={`issues-${g.severity}`} className={`rounded-md border p-3 ${style[g.severity].box}`}>
                <h3 id={`issues-${g.severity}`} className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  {style[g.severity].icon}
                  {t(`report.severity.${g.severity}`)}
                  <Badge variant={style[g.severity].badge}>{fmtNumber(g.items.length)}</Badge>
                </h3>
                <p className="mb-2 text-2xs text-muted-foreground">{t(`report.severityHint.${g.severity}`)}</p>
                <ul className="space-y-2">
                  {g.items.map((issue, i) => (
                    <li key={i} className="rounded-md border bg-card p-2 text-sm">
                      <div className="mb-1 flex flex-wrap gap-1">
                        <Badge variant="outline">{issue.sheet}</Badge>
                        {issue.row !== null ? (
                          <Badge variant="outline">{t('report.row', { row: issue.row })}</Badge>
                        ) : null}
                      </div>
                      <p className="break-words">{issue.message}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))
        )}
      </CardContent>
    </Card>
  );
}

function PhoneDecisionCard({ batchId }: { batchId: number }) {
  const { t } = useTranslation('settings');
  const [pending, setPending] = useState<boolean | null>(null);
  const [recorded, setRecorded] = useState<boolean | null>(null);

  const decide = useMutation({
    mutationFn: (confirm: boolean) => api.post<{ ok: true }>(`/import/batches/${batchId}/confirm-phones`, { confirm }),
    onSuccess: (_d, confirm) => {
      setRecorded(confirm);
      setPending(null);
      toast.success(confirm ? t('report.phonesConfirmedOk') : t('report.phonesDeclinedOk'));
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PhoneOff className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('report.phonesTitle')}
        </CardTitle>
        <CardDescription>{t('report.phonesHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">{t('report.phonesBody')}</p>
        {recorded !== null ? (
          <div role="status" className="rounded-md border border-profit/30 bg-profit/5 px-3 py-2 text-xs">
            {recorded ? t('report.phonesRecordedYes') : t('report.phonesRecordedNo')}
          </div>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => setPending(true)} disabled={decide.isPending}>
            {t('report.phonesConfirm')}
          </Button>
          <Button variant="outline" onClick={() => setPending(false)} disabled={decide.isPending}>
            {t('report.phonesDecline')}
          </Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('report.phonesTitle')}
        message={pending ? t('report.phonesConfirmMessage') : t('report.phonesDeclineMessage')}
        confirmLabel={t('common:action.confirm')}
        destructive={false}
        busy={decide.isPending}
        onConfirm={() => pending !== null && decide.mutate(pending)}
      />
    </Card>
  );
}
