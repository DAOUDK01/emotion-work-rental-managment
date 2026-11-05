import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  Archive,
  Clock,
  Download,
  FileSpreadsheet,
  Package,
  Percent,
  Receipt,
  ShoppingCart,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, downloadFile, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import { defaultPeriod, type Period, PeriodSelector } from '@/components/PeriodSelector';
import { PnlView, SalesView } from './SalesPnlViews';
import { DiscountsView, InventoryView, OutstandingView } from './LedgerViews';
import { AccountantPackView, CashLedgerView, ZReportsView } from './CashZViews';
import {
  NO_STAFF_REPORTS,
  REPORT_TYPES,
  SALES_GROUP_BY,
  type Lookups,
  type ReportType,
  type SalesGroupBy,
} from './types';

const ICONS: Record<ReportType, LucideIcon> = {
  sales: ShoppingCart,
  pnl: TrendingUp,
  discounts: Percent,
  outstanding: Clock,
  inventory: Package,
  cashLedger: Wallet,
  zreports: Receipt,
  accountantPack: Archive,
};

/** Reports that are a snapshot "as of today" and take no period. */
const SNAPSHOT_REPORTS: ReportType[] = ['outstanding', 'inventory'];

type ExportFormat = 'pdf' | 'xlsx';

export default function ReportsPage() {
  const { t, i18n } = useTranslation('reports');
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [period, setPeriod] = useState<Period>(() => defaultPeriod('month'));
  const [groupBy, setGroupBy] = useState<SalesGroupBy>('model');
  const [pnlModelId, setPnlModelId] = useState<number>(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const available = useMemo(
    () => REPORT_TYPES.filter((r) => user?.role !== 'STAFF' || !NO_STAFF_REPORTS.includes(r)),
    [user?.role],
  );
  const requested = searchParams.get('report') as ReportType | null;
  const type: ReportType = requested && available.includes(requested) ? requested : 'sales';

  const selectType = (next: ReportType) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('report', next);
    setSearchParams(sp, { replace: true });
  };

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIndex = (index + 1) % available.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIndex = (index - 1 + available.length) % available.length;
    else if (e.key === 'Home') nextIndex = 0;
    else if (e.key === 'End') nextIndex = available.length - 1;
    if (nextIndex === null) return;
    e.preventDefault();
    selectType(available[nextIndex]);
    tabRefs.current[nextIndex]?.focus();
  };

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
  const models = lookups.data?.models ?? [];

  const { from, to } = period;
  const today = todayInHelsinki();

  /** File endpoint + download name for the current report (null for the accountant pack). */
  const exportTarget = (format: ExportFormat): { path: string; name: string } | null => {
    switch (type) {
      case 'sales':
        return { path: '/reports/sales' + qs({ groupBy, from, to, format }), name: `sales-by-${groupBy}-${from}-${to}.${format}` };
      case 'pnl':
        return {
          path: '/reports/pnl' + qs({ from, to, modelId: pnlModelId || undefined, format }),
          name: `pnl-${from}-${to}.${format}`,
        };
      case 'discounts':
        return { path: '/reports/discounts' + qs({ from, to, format }), name: `discounts-${from}-${to}.${format}` };
      case 'outstanding':
        return { path: '/reports/outstanding' + qs({ format }), name: `outstanding-${today}.${format}` };
      case 'inventory':
        return { path: '/reports/inventory' + qs({ format }), name: `inventory-${today}.${format}` };
      case 'cashLedger':
        return { path: '/reports/cash-ledger' + qs({ from, to, format }), name: `cash-ledger-${from}-${to}.${format}` };
      case 'zreports':
        return { path: '/reports/zreports' + qs({ from, to, format }), name: `zreports-${from}-${to}.${format}` };
      case 'accountantPack':
        return null;
    }
  };

  const download = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const target = exportTarget(format);
      if (target) await downloadFile(target.path, target.name);
    },
    onSuccess: () => toast.success(t('download.ready')),
    onError: (err: Error) => toast.error(err.message || t('download.failed')),
  });

  const usesPeriod = type !== 'accountantPack' && !SNAPSHOT_REPORTS.includes(type);
  const exportable = type !== 'accountantPack';

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} />

      <div className="grid gap-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
        {/* report types: chips on mobile, left rail on desktop */}
        <nav aria-label={t('nav.label')} className="-mx-1 lg:mx-0">
          <div
            role="tablist"
            aria-orientation="vertical"
            className="flex gap-1.5 overflow-x-auto px-1 pb-1 lg:sticky lg:top-4 lg:flex-col lg:overflow-visible lg:rounded-lg lg:border lg:bg-card lg:p-1.5"
          >
            {available.map((r, i) => {
              const Icon = ICONS[r];
              const active = r === type;
              return (
                <button
                  key={r}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  id={`report-tab-${r}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="report-panel"
                  tabIndex={active ? 0 : -1}
                  onClick={() => selectType(r)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={cn(
                    'inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    'lg:w-full lg:rounded-md lg:border-0 lg:py-2 lg:text-left lg:text-sm',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                      : 'bg-card text-muted-foreground hover:bg-muted hover:text-foreground lg:bg-transparent',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {t(`types.${r}`)}
                </button>
              );
            })}
          </div>
        </nav>

        <section
          id="report-panel"
          role="tabpanel"
          aria-labelledby={`report-tab-${type}`}
          className="min-w-0 space-y-4"
        >
          <div className="space-y-3 rounded-lg border bg-card p-3 sm:p-4">
            <div>
              <h2 className="text-base font-semibold">{t(`types.${type}`)}</h2>
              <p className="text-xs text-muted-foreground">{t(`descriptions.${type}`)}</p>
            </div>
            {exportable ? (
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div className="flex flex-wrap items-end gap-2">
                  {usesPeriod ? <PeriodSelector value={period} onChange={setPeriod} /> : null}
                  {!usesPeriod ? (
                    <span className="text-xs text-muted-foreground">{t('asOfToday', { date: fmtDate(today) })}</span>
                  ) : null}
                  {type === 'sales' ? (
                    <label className="flex items-center gap-2 text-xs font-medium">
                      {t('filters.groupBy')}
                      <Select
                        className="h-8 w-40 text-xs"
                        value={groupBy}
                        onChange={(e) => setGroupBy(e.target.value as SalesGroupBy)}
                      >
                        {SALES_GROUP_BY.map((g) => (
                          <option key={g} value={g}>
                            {t(`groupBy.${g}`)}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : null}
                  {type === 'pnl' ? (
                    <label className="flex items-center gap-2 text-xs font-medium">
                      {t('filters.model')}
                      <Select
                        className="h-8 w-44 text-xs"
                        value={pnlModelId}
                        disabled={lookups.isPending}
                        onChange={(e) => setPnlModelId(Number(e.target.value))}
                      >
                        <option value={0}>{t('filters.allModels')}</option>
                        {models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {i18n.language === 'fi' ? m.nameFi : m.nameEn}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={download.isPending}
                    onClick={() => download.mutate('pdf')}
                  >
                    <Download className="h-3.5 w-3.5" />
                    {download.isPending && download.variables === 'pdf'
                      ? t('download.preparing')
                      : t('common:action.downloadPdf')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={download.isPending}
                    onClick={() => download.mutate('xlsx')}
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                    {download.isPending && download.variables === 'xlsx'
                      ? t('download.preparing')
                      : t('common:action.downloadExcel')}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {type === 'sales' ? <SalesView from={from} to={to} groupBy={groupBy} /> : null}
          {type === 'pnl' ? <PnlView from={from} to={to} modelId={pnlModelId} models={models} /> : null}
          {type === 'discounts' ? <DiscountsView from={from} to={to} models={models} /> : null}
          {type === 'outstanding' ? <OutstandingView /> : null}
          {type === 'inventory' ? <InventoryView /> : null}
          {type === 'cashLedger' ? <CashLedgerView from={from} to={to} /> : null}
          {type === 'zreports' ? <ZReportsView from={from} to={to} /> : null}
          {type === 'accountantPack' ? <AccountantPackView /> : null}
        </section>
      </div>
    </div>
  );
}
