import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, Info, RefreshCcw, TriangleAlert } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, downloadFile, qs } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, KpiCard } from '@/components/ui/card';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { defaultPeriod, type Period, PeriodSelector } from '@/components/PeriodSelector';
import { IncomeLinesSection, PurchaseLinesSection } from './VatLineTables';
import { bpLabel, errMsg, type TaxLookups, type VatModelRef, type VatReport } from './types';

type ExportFormat = 'pdf' | 'xlsx';

/** Corporate income tax line driven by lookups.taxRates ("20 % now, 18 % from January 2027"). */
function TaxFooter() {
  const { t, i18n } = useTranslation('vat');
  const lang = i18n.language;
  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<TaxLookups>('/lookups'),
    staleTime: 5 * 60_000,
  });

  if (lookups.isPending) {
    return <p className="text-xs text-muted-foreground">{t('common:common.loading')}</p>;
  }
  if (lookups.isError) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t('tax.unavailable')}</span>
        <Button variant="ghost" size="sm" onClick={() => void lookups.refetch()}>
          <RefreshCcw className="h-3.5 w-3.5" /> {t('common:action.retry')}
        </Button>
      </div>
    );
  }

  const today = todayInHelsinki();
  const rates = [...lookups.data.taxRates].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  if (rates.length === 0) return null;
  const current = [...rates].reverse().find((r) => r.validFrom <= today) ?? null;
  const next = rates.find((r) => r.validFrom > today) ?? null;

  const fromLabel = (iso: string): string => {
    if (lang !== 'fi' && iso.endsWith('-01')) {
      return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${iso}T12:00:00Z`),
      );
    }
    return fmtDate(iso);
  };

  let text: string;
  if (current && next) {
    text = t('tax.withNext', {
      now: bpLabel(current.rateBp, lang),
      next: bpLabel(next.rateBp, lang),
      date: fromLabel(next.validFrom),
    });
  } else if (current) {
    text = t('tax.single', { now: bpLabel(current.rateBp, lang) });
  } else if (next) {
    text = t('tax.onlyNext', { next: bpLabel(next.rateBp, lang), date: fromLabel(next.validFrom) });
  } else {
    return null;
  }

  return (
    <p className="border-t pt-3 text-xs text-muted-foreground">
      {text} <span className="text-2xs">— {t('tax.hint')}</span>
    </p>
  );
}

export default function VatPage() {
  const { t, i18n } = useTranslation('vat');
  const lang = i18n.language;
  const [period, setPeriod] = useState<Period>(() => defaultPeriod('month'));
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const report = useQuery({
    queryKey: ['vat', 'report', period.from, period.to],
    queryFn: () => api.get<VatReport>('/vat/report' + qs({ from: period.from, to: period.to })),
    placeholderData: keepPreviousData,
  });

  const modelName = (m: VatModelRef) => (lang === 'fi' ? m.nameFi : m.nameEn);

  const runExport = async (format: ExportFormat) => {
    setExporting(format);
    try {
      await downloadFile(
        '/vat/export' + qs({ from: period.from, to: period.to, format }),
        `vat-report-${period.from}-${period.to}.${format}`,
      );
      toast.success(t('export.ready'));
    } catch (err) {
      toast.error(errMsg(err, t('export.failed')));
    } finally {
      setExporting(null);
    }
  };

  const data = report.data;
  const refreshing = report.isFetching && report.isPlaceholderData;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />

      {/* period + exports */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodSelector value={period} onChange={setPeriod} />
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            aria-busy={exporting === 'pdf'}
            onClick={() => void runExport('pdf')}
          >
            <Download className="h-3.5 w-3.5" />
            {exporting === 'pdf' ? t('export.preparing') : t('common:action.downloadPdf')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            aria-busy={exporting === 'xlsx'}
            onClick={() => void runExport('xlsx')}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            {exporting === 'xlsx' ? t('export.preparing') : t('common:action.downloadExcel')}
          </Button>
        </div>
      </div>

      {report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : !data ? (
        <LoadingState label={t('loading')} />
      ) : (
        <div
          className={cn('space-y-4 transition-opacity', refreshing && 'opacity-60')}
          aria-busy={refreshing}
        >
          {/* cards — PDF Figure 3 */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard label={t('cards.collected')} value={fmtEUR(data.cards.collectedCents)} sub={t('cards.collectedSub')} />
            <KpiCard
              label={t('cards.reclaimable')}
              value={fmtEUR(data.cards.reclaimableCents)}
              sub={t('cards.reclaimableSub')}
            />
            <KpiCard
              label={data.cards.payableCents < 0 ? t('cards.refund') : t('cards.payable')}
              value={fmtEUR(data.cards.payableCents)}
              sub={data.cards.payableCents < 0 ? t('cards.refundSub') : t('cards.payableSub')}
              tone={data.cards.payableCents > 0 ? 'loss' : data.cards.payableCents < 0 ? 'profit' : 'default'}
            />
            <KpiCard label={t('cards.nonVat')} value={fmtEUR(data.cards.nonVatIncomeCents)} sub={t('cards.nonVatSub')} />
          </div>

          {data.note ? (
            <div
              className="flex items-start gap-2 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300"
              role="note"
            >
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                <span className="font-semibold">{t('note.title')}: </span>
                {data.note}
              </p>
            </div>
          ) : null}

          {data.undatedNote ? (
            <div
              className="flex items-start gap-2 rounded-md border border-sky-400/50 bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300"
              role="note"
            >
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <p>
                {t('undated.text', {
                  count: data.undatedNote.count,
                  gross: fmtEUR(data.undatedNote.grossCents),
                  vat: fmtEUR(data.undatedNote.reclaimableVatCents),
                })}
              </p>
            </div>
          ) : null}

          {data.incomeLines.length === 0 && data.purchaseLines.length === 0 ? (
            <EmptyState
              title={t('empty.title')}
              hint={t('empty.hint', { from: fmtDate(period.from), to: fmtDate(period.to) })}
            />
          ) : (
            <>
              <ByModelCard report={data} modelName={modelName} />
              <IncomeLinesSection lines={data.incomeLines} modelName={modelName} />
              <PurchaseLinesSection lines={data.purchaseLines} />
            </>
          )}
        </div>
      )}

      <TaxFooter />
    </div>
  );
}

/** BY MODEL: income of the period split by VAT treatment, with a totals row. */
function ByModelCard({ report, modelName }: { report: VatReport; modelName: (m: VatModelRef) => string }) {
  const { t } = useTranslation('vat');
  const totals = report.byModel.reduce(
    (acc, r) => ({
      withVat: acc.withVat + r.withVatGrossCents,
      vat: acc.vat + r.vatCents,
      noVat: acc.noVat + r.noVatCents,
    }),
    { withVat: 0, vat: 0, noVat: 0 },
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('byModel.title')}</CardTitle>
        <CardDescription>{t('byModel.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {report.byModel.length === 0 ? (
          <EmptyState title={t('byModel.empty')} hint={t('byModel.emptyHint')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('byModel.model')}</TH>
                <TH className="text-right">{t('byModel.withVat')}</TH>
                <TH className="text-right">{t('byModel.vat')}</TH>
                <TH className="text-right">{t('byModel.noVat')}</TH>
              </TR>
            </THead>
            <TBody>
              {report.byModel.map((r) => (
                <TR key={r.model.id}>
                  <TD className="font-medium">{modelName(r.model)}</TD>
                  <TDMoney className="whitespace-nowrap">{fmtEUR(r.withVatGrossCents)}</TDMoney>
                  <TDMoney className="whitespace-nowrap">{fmtEUR(r.vatCents)}</TDMoney>
                  <TDMoney className="whitespace-nowrap">{fmtEUR(r.noVatCents)}</TDMoney>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD>{t('common:common.total')}</TD>
                <TDMoney className="whitespace-nowrap">{fmtEUR(totals.withVat)}</TDMoney>
                <TDMoney className="whitespace-nowrap">{fmtEUR(totals.vat)}</TDMoney>
                <TDMoney className="whitespace-nowrap">{fmtEUR(totals.noVat)}</TDMoney>
              </TR>
            </TFoot>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
