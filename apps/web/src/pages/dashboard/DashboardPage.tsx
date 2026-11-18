import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bike,
  Calculator,
  CalendarRange,
  ChartBarBig,
  ChartLine,
  ChevronDown,
  ChevronUp,
  Download,
  FileSpreadsheet,
  Gauge,
  Hourglass,
  Info,
  Landmark,
  Layers,
  PiggyBank,
  ReceiptText,
  RotateCcw,
  Scale,
  ShoppingBag,
  SlidersHorizontal,
  Tag,
  TrendingUp,
  UserRoundCheck,
  Wallet,
} from 'lucide-react';
import { api, downloadFile, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtEUR, fmtEURShort, fmtGrowth, fmtNumber, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, KpiCard } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { CHART, CompareLines, GrowthBars, HBars, StackedBars } from '@/components/charts';
import { defaultPeriod, type Period, PeriodSelector } from '@/components/PeriodSelector';
import { CashAlerts, ChartCard, DashboardSkeleton, PaybackBar, SectionLabel } from './widgets';

interface Lookups {
  models: Array<{ id: number; code: string; nameEn: string; nameFi: string; color: string | null }>;
  holders: Array<{ id: number; name: string }>;
}

interface Summary {
  note: string;
  kpis: {
    totalSalesCents: number;
    totalNetCents: number;
    receivedCents: number;
    outstandingCents: number;
    outstandingCustomers: number;
    expensesCents: number;
    salariesCents: number;
    unitPurchasesCents: number;
    unitPurchasesCounted: boolean;
    netProfitCents: number;
    profitMarginPct: number | null;
    vatCollectedCents: number;
    vatReclaimableCents: number;
    vatPayableCents: number;
    nonVatIncomeCents: number;
    discountsCents: number;
    discountCount: number;
    orders: number;
    avgOrderCents: number;
    rentalPaybackPct: number | null;
    taxRateBp: number;
    taxEstimateCents: number;
    profitAfterTaxCents: number;
  };
  revenueByModel: Array<{
    model: Lookups['models'][number];
    grossCents: number;
    receivedCents: number;
    outstandingCents: number;
  }>;
  profitByModel: Array<{ model: Lookups['models'][number]; profitCents: number }>;
  sharedCostsRow: { label: string; amountCents: number } | null;
  monthlyTrend: Array<{
    key: string;
    label: string;
    receivedCents: number;
    outstandingCents: number;
  }>;
  revenueByReceiver: Array<{ label: string; grossCents: number }>;
  expensesByType: Array<{ category: string; grossCents: number }>;
  rentalByCategory: Array<{ category: string; receivedCents: number; outstandingCents: number }>;
}

interface GrowthPoint {
  key: string;
  label: string;
  valueCents: number;
  pctChange: number | null;
}

interface UnitPerf {
  rows: Array<{
    unitId: number;
    code: string;
    category: string;
    status: string;
    rentalOrders: number;
    rentalRevenueCents: number;
    purchaseCents: number;
    diffCents: number;
    paybackPct: number | null;
  }>;
  totals: {
    rentalOrders: number;
    rentalRevenueCents: number;
    purchaseCents: number;
    diffCents: number;
    paybackPct: number | null;
  };
}

interface CashBalances {
  balances: Array<{
    holder: { id: number; name: string; kind: string };
    holdingCents: number;
    oldestUnsettledDate: string | null;
    overdueAlert: boolean;
  }>;
}

export default function DashboardPage() {
  const { t, i18n } = useTranslation('dashboard');
  const { user } = useAuth();
  const lang = i18n.language;
  const [period, setPeriod] = useState<Period>(() => defaultPeriod('month'));
  const [modelId, setModelId] = useState<number | 0>(0);
  const [unitId, setUnitId] = useState<number | 0>(0);
  const [segment, setSegment] = useState<'' | 'INDIVIDUAL' | 'BUSINESS'>('');
  const [receivedById, setReceivedById] = useState<number | 0>(0);
  const [granularity, setGranularity] = useState<'weekly' | 'monthly' | 'yearly'>('weekly');
  const [count, setCount] = useState(4);
  const [compare, setCompare] = useState(false);
  // Keep the first view simple: the PDF's six cards + three charts. The extra filters
  // and the extra cards/charts/unit table open on demand.
  const [showFilters, setShowFilters] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const extraFilterActive = unitId !== 0 || segment !== '' || receivedById !== 0;

  const filterQs = useMemo(
    () =>
      qs({
        from: period.from,
        to: period.to,
        modelId: modelId || undefined,
        unitId: unitId || undefined,
        segment: segment || undefined,
        receivedById: receivedById || undefined,
      }),
    [period, modelId, unitId, segment, receivedById],
  );

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<Lookups>('/lookups'),
    staleTime: 5 * 60_000,
  });
  const units = useQuery({
    queryKey: ['units', 'list-light'],
    queryFn: () =>
      api.get<{ units: Array<{ id: number; code: string }> }>('/units' + qs({ pageSize: 200 })),
    staleTime: 60_000,
    enabled: showFilters,
  });
  const summary = useQuery({
    queryKey: ['dashboard', 'summary', filterQs],
    queryFn: () => api.get<Summary>('/dashboard/summary' + filterQs),
  });
  const growth = useQuery<{
    points?: GrowthPoint[];
    series?: Array<{ model: Lookups['models'][number]; points: GrowthPoint[] }>;
  }>({
    queryKey: [
      'dashboard',
      'growth',
      granularity,
      count,
      modelId,
      segment,
      receivedById,
      period.to,
      compare,
    ],
    queryFn: () =>
      compare
        ? api.get<{ series: Array<{ model: Lookups['models'][number]; points: GrowthPoint[] }> }>(
            '/dashboard/compare-models' +
              qs({
                granularity,
                count,
                endDate: period.to,
                segment: segment || undefined,
                receivedById: receivedById || undefined,
              }),
          )
        : api.get<{ points: GrowthPoint[] }>(
            '/dashboard/growth' +
              qs({
                granularity,
                count,
                endDate: period.to,
                modelId: modelId || undefined,
                segment: segment || undefined,
                receivedById: receivedById || undefined,
              }),
          ),
  });
  const unitPerf = useQuery({
    queryKey: ['dashboard', 'unit-performance', period.from, period.to, segment],
    queryFn: () =>
      api.get<UnitPerf>(
        '/dashboard/unit-performance' +
          qs({ from: period.from, to: period.to, segment: segment || undefined }),
      ),
    enabled: showDetails,
  });
  const cash = useQuery({
    queryKey: ['cash', 'balances'],
    queryFn: () => api.get<CashBalances>('/cash/balances'),
    retry: false,
  });

  const modelName = (m: Lookups['models'][number]) => (lang === 'fi' ? m.nameFi : m.nameEn);
  const k = summary.data?.kpis;

  const countOptions =
    granularity === 'weekly'
      ? [4, 8, 12].map((n) => ({ value: n, label: `${n} ${t('charts.weeks')}` }))
      : granularity === 'monthly'
        ? [6, 12].map((n) => ({ value: n, label: `${n} ${t('charts.months')}` }))
        : [3, 5].map((n) => ({ value: n, label: `${n} ${t('charts.years')}` }));

  const overdue = (cash.data?.balances ?? [])
    .filter((b) => b.overdueAlert)
    .map((b) => ({
      id: b.holder.id,
      name: b.holder.name,
      holdingCents: b.holdingCents,
      oldestUnsettledDate: b.oldestUnsettledDate,
    }));
  const extraFilterCount = (unitId ? 1 : 0) + (segment ? 1 : 0) + (receivedById ? 1 : 0);
  const filtersOpen = showFilters || extraFilterActive;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {/* page header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-accent">
            {t('header.eyebrow')}
          </p>
          <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('header.subtitle', { from: fmtDate(period.from), to: fmtDate(period.to) })}
          </p>
        </div>
        <div className={user?.role === 'STAFF' ? 'hidden' : 'flex gap-2'}>
          <Button
            variant="outline"
            onClick={() =>
              void downloadFile(
                `/dashboard/export${filterQs}&format=pdf`,
                `dashboard-${period.from}-${period.to}.pdf`,
              )
            }
          >
            <Download className="h-4 w-4" /> {t('common:action.downloadPdf')}
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              void downloadFile(
                `/dashboard/export${filterQs}&format=xlsx`,
                `dashboard-${period.from}-${period.to}.xlsx`,
              )
            }
          >
            <FileSpreadsheet className="h-4 w-4" /> {t('common:action.downloadExcel')}
          </Button>
        </div>
      </div>

      {/* alerts: partner cash held too long */}
      <CashAlerts items={overdue} />

      {/* filter toolbar */}
      <Card className="divide-y divide-border/70 overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3 sm:px-5">
          <PeriodSelector value={period} onChange={setPeriod} />
          <Button
            variant={filtersOpen ? 'secondary' : 'ghost'}
            size="sm"
            className="mb-0.5"
            aria-expanded={filtersOpen}
            onClick={() => {
              if (filtersOpen) {
                setUnitId(0);
                setSegment('');
                setReceivedById(0);
                setShowFilters(false);
              } else {
                setShowFilters(true);
              }
            }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {filtersOpen ? t('filters.fewer') : t('filters.more')}
            {extraFilterCount > 0 ? (
              <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.62rem] font-bold text-accent-foreground">
                {extraFilterCount}
              </span>
            ) : null}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-surface/40 px-4 py-2.5 sm:px-5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            {t('filters.model')}
          </span>
          <Segmented
            size="sm"
            value={modelId}
            onChange={setModelId}
            options={[
              { value: 0 as const, label: t('filters.allModels') },
              ...(lookups.data?.models ?? []).map((m) => ({ value: m.id, label: modelName(m) })),
            ]}
          />
        </div>
        {filtersOpen ? (
          <div className="grid gap-3 bg-surface/40 px-4 py-3 sm:grid-cols-3 sm:px-5">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('filters.unit')}</span>
              <Select
                aria-label={t('filters.unit')}
                value={unitId}
                onChange={(e) => setUnitId(Number(e.target.value))}
              >
                <option value={0}>{t('filters.allUnits')}</option>
                {(units.data?.units ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('filters.segment')}
              </span>
              <Select
                aria-label={t('filters.segment')}
                value={segment}
                onChange={(e) => setSegment(e.target.value as typeof segment)}
              >
                <option value="">{t('filters.allSegments')}</option>
                <option value="INDIVIDUAL">{t('filters.individual')}</option>
                <option value="BUSINESS">{t('filters.business')}</option>
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {t('filters.receivedBy')}
              </span>
              <Select
                aria-label={t('filters.receivedBy')}
                value={receivedById}
                onChange={(e) => setReceivedById(Number(e.target.value))}
              >
                <option value={0}>{t('filters.anyReceiver')}</option>
                {(lookups.data?.holders ?? []).map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        ) : null}
      </Card>

      {summary.isLoading ? <DashboardSkeleton /> : null}
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}

      {k ? (
        <div
          className={cn(
            'space-y-6 transition-opacity',
            summary.isFetching && !summary.isLoading && 'opacity-70',
          )}
        >
          {/* KPI grid — PDF Figure 1 */}
          <section className="space-y-3">
            <SectionLabel>{t('sections.keyFigures')}</SectionLabel>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-6">
              <KpiCard
                icon={TrendingUp}
                accent="navy"
                label={t('kpi.totalSales')}
                value={fmtEURShort(k.totalSalesCents)}
                sub={t('kpi.inclVat')}
              />
              <KpiCard
                icon={ReceiptText}
                accent="amber"
                label={t('kpi.expenses')}
                value={fmtEURShort(k.expensesCents)}
                sub={t('kpi.allCategories')}
              />
              <KpiCard
                icon={PiggyBank}
                label={t('kpi.netProfit')}
                value={fmtEURShort(k.netProfitCents)}
                sub={
                  k.profitMarginPct !== null ? (
                    <MarginPill pct={k.profitMarginPct} label={t('kpi.margin')} />
                  ) : undefined
                }
                tone={k.netProfitCents >= 0 ? 'profit' : 'loss'}
              />
              <KpiCard
                icon={Landmark}
                accent="violet"
                label={t('kpi.vatPayable')}
                value={fmtEURShort(k.vatPayableCents)}
                sub={t('kpi.collectedMinusReclaimable')}
              />
              <KpiCard
                icon={Tag}
                accent="sky"
                label={t('kpi.discounts')}
                value={fmtEURShort(k.discountsCents)}
                sub={`${k.discountCount} ${t('kpi.promotions')}`}
              />
              <KpiCard
                icon={Hourglass}
                accent={k.outstandingCents > 0 ? 'loss' : 'rose'}
                label={t('kpi.unpaid')}
                value={fmtEURShort(k.outstandingCents)}
                sub={`${k.outstandingCustomers} ${t('kpi.customers')}`}
                tone={k.outstandingCents > 0 ? 'loss' : 'default'}
              />
            </div>
          </section>

          {/* main charts */}
          <section className="space-y-3">
            <SectionLabel>{t('sections.performance')}</SectionLabel>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard
                icon={ChartBarBig}
                accent="navy"
                title={t('charts.revenueByModel')}
                description={t('charts.longestBar')}
              >
                <HBars
                  data={summary.data!.revenueByModel.map((r) => ({
                    label: modelName(r.model),
                    value: r.grossCents,
                  }))}
                  color={CHART.navy}
                />
              </ChartCard>
              <ChartCard
                icon={Scale}
                accent="profit"
                title={t('charts.profitByModel')}
                description={t('charts.greenRed')}
              >
                <HBars
                  data={[
                    ...summary.data!.profitByModel.map((r) => ({
                      label: modelName(r.model),
                      value: r.profitCents,
                    })),
                    ...(summary.data!.sharedCostsRow
                      ? [
                          {
                            label: summary.data!.sharedCostsRow.label,
                            value: summary.data!.sharedCostsRow.amountCents,
                          },
                        ]
                      : []),
                  ]}
                  colorBy="sign"
                />
              </ChartCard>
            </div>

            {/* growth by time */}
            <ChartCard
              icon={ChartLine}
              accent="teal"
              title={t('charts.growth')}
              description={
                compare
                  ? t('charts.compareModels')
                  : modelId
                    ? modelName(lookups.data!.models.find((m) => m.id === modelId)!)
                    : t('filters.allModels')
              }
              actions={
                <>
                  <Segmented
                    size="sm"
                    value={granularity}
                    onChange={(g) => {
                      setGranularity(g);
                      setCount(g === 'weekly' ? 4 : g === 'monthly' ? 6 : 3);
                    }}
                    options={[
                      { value: 'weekly' as const, label: t('charts.weekly') },
                      { value: 'monthly' as const, label: t('charts.monthly') },
                      { value: 'yearly' as const, label: t('charts.yearly') },
                    ]}
                  />
                  <Segmented size="sm" value={count} onChange={setCount} options={countOptions} />
                  <Segmented
                    size="sm"
                    value={compare ? 1 : 0}
                    onChange={(val) => setCompare(val === 1)}
                    options={[
                      { value: 0 as const, label: t('charts.oneModel') },
                      { value: 1 as const, label: t('charts.compareModels') },
                    ]}
                  />
                </>
              }
            >
              {growth.isLoading ? (
                <LoadingState className="min-h-[260px]" />
              ) : growth.isError ? (
                <ErrorState error={growth.error} onRetry={() => void growth.refetch()} />
              ) : compare && growth.data?.series ? (
                <CompareLines
                  series={growth.data.series.map((s) => ({
                    name: modelName(s.model),
                    color: s.model.color,
                    points: s.points.map((p) => ({ label: p.label, valueCents: p.valueCents })),
                  }))}
                />
              ) : growth.data?.points ? (
                <>
                  <GrowthBars data={growth.data.points} />
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {growth.data.points.map((p) => (
                      <span
                        key={p.key}
                        className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-surface/60 px-2.5 py-0.5 text-2xs tabular-nums text-muted-foreground"
                      >
                        <span className="font-semibold text-foreground">{p.label}</span>
                        {fmtEURShort(p.valueCents)}
                        {p.pctChange !== null ? (
                          <span
                            className={cn(
                              'font-semibold',
                              p.pctChange > 0 && 'text-profit',
                              p.pctChange < 0 && 'text-loss',
                            )}
                          >
                            {fmtGrowth(p.pctChange)}
                          </span>
                        ) : null}
                      </span>
                    ))}
                  </div>
                </>
              ) : null}
            </ChartCard>
          </section>

          {/* details toggle */}
          <div className="flex items-center gap-3">
            <span aria-hidden className="h-px flex-1 bg-border/80" />
            <Button
              variant="outline"
              className="rounded-full px-5"
              onClick={() => setShowDetails((s) => !s)}
              aria-expanded={showDetails}
            >
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {showDetails ? t('details.hide') : t('details.show')}
            </Button>
            <span aria-hidden className="h-px flex-1 bg-border/80" />
          </div>

          {showDetails ? (
            <div className="animate-fade-up space-y-6">
              <section className="space-y-3">
                <SectionLabel>{t('sections.moreFigures')}</SectionLabel>
                {summary.data?.note ? (
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                    {summary.data.note}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
                  <KpiCard
                    icon={Wallet}
                    accent="teal"
                    label={`${t('kpi.received')} / ${t('kpi.outstanding')}`}
                    value={`${fmtEURShort(k.receivedCents)} / ${fmtEURShort(k.outstandingCents)}`}
                  />
                  <KpiCard
                    icon={ShoppingBag}
                    accent="navy"
                    label={t('kpi.orders')}
                    value={fmtNumber(k.orders)}
                    sub={`${fmtEURShort(k.avgOrderCents)} ${t('kpi.avgPerOrder')}`}
                  />
                  <KpiCard
                    icon={RotateCcw}
                    accent="sky"
                    label={t('kpi.rentalPayback')}
                    value={k.rentalPaybackPct === null ? '–' : fmtPct(k.rentalPaybackPct, 1)}
                  />
                  <KpiCard
                    icon={Calculator}
                    accent="violet"
                    label={`${t('kpi.taxEstimate')} (${(k.taxRateBp / 100).toFixed(0)} %)`}
                    value={fmtEURShort(k.taxEstimateCents)}
                    sub={`${fmtEURShort(k.profitAfterTaxCents)} ${t('kpi.afterTax')}`}
                  />
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard icon={CalendarRange} accent="navy" title={t('charts.monthlyTrend')}>
                  <StackedBars
                    data={summary.data!.monthlyTrend.map((m) => ({ ...m, label: m.label }))}
                    aLabel={t('charts.receivedLabel')}
                    bLabel={t('charts.outstandingLabel')}
                  />
                </ChartCard>
                <ChartCard icon={ReceiptText} accent="amber" title={t('charts.expensesByType')}>
                  <HBars
                    data={summary
                      .data!.expensesByType.slice(0, 8)
                      .map((e) => ({ label: e.category, value: e.grossCents }))}
                    color={CHART.orange}
                  />
                </ChartCard>
                <ChartCard
                  icon={UserRoundCheck}
                  accent="violet"
                  title={t('charts.revenueByReceiver')}
                >
                  <HBars
                    data={summary.data!.revenueByReceiver.map((r) => ({
                      label: r.label,
                      value: r.grossCents,
                    }))}
                    color={CHART.purple}
                  />
                </ChartCard>
                <ChartCard icon={Bike} accent="teal" title={t('charts.rentalByCategory')}>
                  <StackedBars
                    data={summary.data!.rentalByCategory.map((c) => ({
                      ...c,
                      label: c.category,
                    }))}
                    aLabel={t('charts.receivedLabel')}
                    bLabel={t('charts.outstandingLabel')}
                    height={200}
                  />
                </ChartCard>
              </div>

              {/* unit performance — PDF Figure 4 */}
              <ChartCard
                icon={Gauge}
                accent="teal"
                title={t('units.title')}
                description={t('units.subtitle')}
              >
                {unitPerf.isError ? (
                  <ErrorState error={unitPerf.error} onRetry={() => void unitPerf.refetch()} />
                ) : !unitPerf.data ? (
                  <LoadingState />
                ) : unitPerf.data.rows.length === 0 ? (
                  <EmptyState icon={Bike} title={t('units.empty')} />
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t('units.unit')}</TH>
                        <TH>{t('units.category')}</TH>
                        <TH>{t('units.status')}</TH>
                        <TH className="text-right">{t('units.orders')}</TH>
                        <TH className="text-right">{t('units.revenue')}</TH>
                        <TH className="text-right">{t('units.cost')}</TH>
                        <TH className="text-right">{t('units.diff')}</TH>
                        <TH className="text-right">{t('units.payback')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {unitPerf.data.rows.map((r) => (
                        <TR key={r.unitId}>
                          <TD className="font-semibold">{r.code}</TD>
                          <TD className="text-muted-foreground">
                            {r.category
                              .replace('E_SCOOTER', 'E-Scooter')
                              .replace('E_BIKE', 'E-Bike')
                              .replace('MOPED', 'Moped')}
                          </TD>
                          <TD>
                            <Badge
                              variant={
                                r.status === 'SOLD'
                                  ? 'info'
                                  : r.status === 'ON_RENT'
                                    ? 'success'
                                    : 'default'
                              }
                            >
                              {r.status.replace('_', ' ')}
                            </Badge>
                          </TD>
                          <TD className="text-right tabular-nums">{r.rentalOrders}</TD>
                          <TDMoney>{fmtEUR(r.rentalRevenueCents)}</TDMoney>
                          <TDMoney className="text-muted-foreground">
                            {fmtEUR(r.purchaseCents)}
                          </TDMoney>
                          <TDMoney
                            className={cn(
                              'font-medium',
                              r.diffCents < 0 ? 'text-loss' : 'text-profit',
                            )}
                          >
                            {fmtEUR(r.diffCents)}
                          </TDMoney>
                          <TD className="text-right">
                            {r.paybackPct === null ? (
                              '–'
                            ) : r.paybackPct >= 100 ? (
                              <Badge variant="success">{t('units.paidBack')}</Badge>
                            ) : (
                              <PaybackBar pct={r.paybackPct} />
                            )}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                    <TFoot>
                      <TR>
                        <TD colSpan={3}>{t('common:common.total')}</TD>
                        <TD className="text-right tabular-nums">
                          {unitPerf.data.totals.rentalOrders}
                        </TD>
                        <TDMoney>{fmtEUR(unitPerf.data.totals.rentalRevenueCents)}</TDMoney>
                        <TDMoney>{fmtEUR(unitPerf.data.totals.purchaseCents)}</TDMoney>
                        <TDMoney
                          className={
                            unitPerf.data.totals.diffCents < 0 ? 'text-loss' : 'text-profit'
                          }
                        >
                          {fmtEUR(unitPerf.data.totals.diffCents)}
                        </TDMoney>
                        <TD className="text-right tabular-nums">
                          {unitPerf.data.totals.paybackPct !== null
                            ? `${unitPerf.data.totals.paybackPct} %`
                            : '–'}
                        </TD>
                      </TR>
                    </TFoot>
                  </Table>
                )}
              </ChartCard>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** "margin 37.8 %" pill under the net-profit figure. */
function MarginPill({ pct, label }: { pct: number; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-px font-medium',
        pct >= 0 ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss',
      )}
    >
      {pct >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {label} {fmtPct(pct, 1)}
    </span>
  );
}
