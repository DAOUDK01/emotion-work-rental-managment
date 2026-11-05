import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Download, FileSpreadsheet, SlidersHorizontal } from 'lucide-react';
import { api, downloadFile, qs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtEUR, fmtEURShort, fmtGrowth, fmtNumber, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  KpiCard,
} from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Badge, ErrorState, LoadingState, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { CompareLines, GrowthBars, HBars, StackedBars } from '@/components/charts';
import { defaultPeriod, type Period, PeriodSelector } from '@/components/PeriodSelector';

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

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {/* alerts: partner cash held too long */}
      {cash.data?.balances
        .filter((b) => b.overdueAlert)
        .map((b) => (
          <div
            key={b.holder.id}
            className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300"
            role="alert"
          >
            {t('alerts.cashHolding', {
              name: b.holder.name,
              amount: fmtEUR(b.holdingCents),
              date: fmtDate(b.oldestUnsettledDate),
            })}
          </div>
        ))}

      {/* filter row */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodSelector value={period} onChange={setPeriod} />
        <div className={user?.role === 'STAFF' ? 'hidden' : 'flex gap-2'}>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void downloadFile(
                `/dashboard/export${filterQs}&format=pdf`,
                `dashboard-${period.from}-${period.to}.pdf`,
              )
            }
          >
            <Download className="h-3.5 w-3.5" /> {t('common:action.downloadPdf')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void downloadFile(
                `/dashboard/export${filterQs}&format=xlsx`,
                `dashboard-${period.from}-${period.to}.xlsx`,
              )
            }
          >
            <FileSpreadsheet className="h-3.5 w-3.5" /> {t('common:action.downloadExcel')}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          size="sm"
          value={modelId}
          onChange={setModelId}
          options={[
            { value: 0 as const, label: t('filters.allModels') },
            ...(lookups.data?.models ?? []).map((m) => ({ value: m.id, label: modelName(m) })),
          ]}
        />
        {!showFilters && !extraFilterActive ? (
          <Button variant="ghost" size="sm" onClick={() => setShowFilters(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" /> {t('filters.more')}
          </Button>
        ) : null}
      </div>
      {showFilters || extraFilterActive ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('filters.unit')}
            className="h-8 w-40 text-xs"
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
          <Select
            aria-label={t('filters.segment')}
            className="h-8 w-40 text-xs"
            value={segment}
            onChange={(e) => setSegment(e.target.value as typeof segment)}
          >
            <option value="">{t('filters.allSegments')}</option>
            <option value="INDIVIDUAL">{t('filters.individual')}</option>
            <option value="BUSINESS">{t('filters.business')}</option>
          </Select>
          <Select
            aria-label={t('filters.receivedBy')}
            className="h-8 w-40 text-xs"
            value={receivedById}
            onChange={(e) => setReceivedById(Number(e.target.value))}
          >
            <option value={0}>
              {t('filters.receivedBy')}: {t('filters.anyReceiver')}
            </option>
            {(lookups.data?.holders ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </Select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setUnitId(0);
              setSegment('');
              setReceivedById(0);
              setShowFilters(false);
            }}
          >
            {t('filters.fewer')}
          </Button>
        </div>
      ) : null}

      {summary.isLoading ? <LoadingState /> : null}
      {summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : null}

      {k ? (
        <>
          {/* KPI grid — PDF Figure 1 */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label={t('kpi.totalSales')}
              value={fmtEURShort(k.totalSalesCents)}
              sub={t('kpi.inclVat')}
            />
            <KpiCard
              label={t('kpi.expenses')}
              value={fmtEURShort(k.expensesCents)}
              sub={t('kpi.allCategories')}
            />
            <KpiCard
              label={t('kpi.netProfit')}
              value={fmtEURShort(k.netProfitCents)}
              sub={
                k.profitMarginPct !== null
                  ? `${t('kpi.margin')} ${fmtPct(k.profitMarginPct, 1)}`
                  : undefined
              }
              tone={k.netProfitCents >= 0 ? 'profit' : 'loss'}
            />
            <KpiCard
              label={t('kpi.vatPayable')}
              value={fmtEURShort(k.vatPayableCents)}
              sub={t('kpi.collectedMinusReclaimable')}
            />
            <KpiCard
              label={t('kpi.discounts')}
              value={fmtEURShort(k.discountsCents)}
              sub={`${k.discountCount} ${t('kpi.promotions')}`}
            />
            <KpiCard
              label={t('kpi.unpaid')}
              value={fmtEURShort(k.outstandingCents)}
              sub={`${k.outstandingCustomers} ${t('kpi.customers')}`}
              tone={k.outstandingCents > 0 ? 'loss' : 'default'}
            />
          </div>

          {/* main charts */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t('charts.revenueByModel')}</CardTitle>
                <CardDescription>{t('charts.longestBar')}</CardDescription>
              </CardHeader>
              <CardContent>
                <HBars
                  data={summary.data!.revenueByModel.map((r) => ({
                    label: modelName(r.model),
                    value: r.grossCents,
                  }))}
                  color="#0b2545"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('charts.profitByModel')}</CardTitle>
                <CardDescription>{t('charts.greenRed')}</CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </div>
          {/* growth by time */}
          <Card>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <div>
                <CardTitle>{t('charts.growth')}</CardTitle>
                <CardDescription>
                  {compare
                    ? t('charts.compareModels')
                    : modelId
                      ? modelName(lookups.data!.models.find((m) => m.id === modelId)!)
                      : t('filters.allModels')}
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
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
                  onChange={(v) => setCompare(v === 1)}
                  options={[
                    { value: 0 as const, label: t('charts.oneModel') },
                    { value: 1 as const, label: t('charts.compareModels') },
                  ]}
                />
              </div>
            </CardHeader>
            <CardContent>
              {growth.isLoading ? (
                <LoadingState />
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
                  <p className="mt-1 text-center text-2xs text-muted-foreground">
                    {growth.data.points
                      .map(
                        (p) =>
                          `${p.label} ${fmtEURShort(p.valueCents)}${p.pctChange !== null ? ` (${fmtGrowth(p.pctChange)})` : ''}`,
                      )
                      .join(' · ')}
                  </p>
                </>
              ) : null}
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDetails((s) => !s)}
              aria-expanded={showDetails}
            >
              {showDetails ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showDetails ? t('details.hide') : t('details.show')}
            </Button>
          </div>

          {showDetails ? (
            <>
              <p className="text-2xs text-muted-foreground">{summary.data?.note}</p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <KpiCard
                  label={`${t('kpi.received')} / ${t('kpi.outstanding')}`}
                  value={`${fmtEURShort(k.receivedCents)} / ${fmtEURShort(k.outstandingCents)}`}
                />
                <KpiCard
                  label={t('kpi.orders')}
                  value={fmtNumber(k.orders)}
                  sub={`${fmtEURShort(k.avgOrderCents)} ${t('kpi.avgPerOrder')}`}
                />
                <KpiCard
                  label={t('kpi.rentalPayback')}
                  value={k.rentalPaybackPct === null ? '–' : fmtPct(k.rentalPaybackPct, 1)}
                />
                <KpiCard
                  label={`${t('kpi.taxEstimate')} (${(k.taxRateBp / 100).toFixed(0)} %)`}
                  value={fmtEURShort(k.taxEstimateCents)}
                  sub={`${fmtEURShort(k.profitAfterTaxCents)} ${t('kpi.afterTax')}`}
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('charts.monthlyTrend')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <StackedBars
                      data={summary.data!.monthlyTrend.map((m) => ({ ...m, label: m.label }))}
                      aLabel={t('charts.receivedLabel')}
                      bLabel={t('charts.outstandingLabel')}
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('charts.expensesByType')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HBars
                      data={summary
                        .data!.expensesByType.slice(0, 8)
                        .map((e) => ({ label: e.category, value: e.grossCents }))}
                      color="#2a9d8f"
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('charts.revenueByReceiver')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <HBars
                      data={summary.data!.revenueByReceiver.map((r) => ({
                        label: r.label,
                        value: r.grossCents,
                      }))}
                      color="#6b5bd2"
                    />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t('charts.rentalByCategory')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <StackedBars
                      data={summary.data!.rentalByCategory.map((c) => ({
                        ...c,
                        label: c.category,
                      }))}
                      aLabel={t('charts.receivedLabel')}
                      bLabel={t('charts.outstandingLabel')}
                      height={200}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* unit performance — PDF Figure 4 */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('units.title')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {unitPerf.data ? (
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
                            <TD className="font-medium">{r.code}</TD>
                            <TD>
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
                            <TDMoney>{fmtEUR(r.purchaseCents)}</TDMoney>
                            <TDMoney className={r.diffCents < 0 ? 'text-loss' : 'text-profit'}>
                              {fmtEUR(r.diffCents)}
                            </TDMoney>
                            <TD className="text-right">
                              {r.paybackPct === null ? (
                                '–'
                              ) : r.paybackPct >= 100 ? (
                                <Badge variant="success">{t('units.paidBack')}</Badge>
                              ) : (
                                <div className="flex items-center justify-end gap-2">
                                  <div className="h-2 w-20 overflow-hidden rounded bg-muted">
                                    <div
                                      className="h-full rounded bg-navy"
                                      style={{ width: `${Math.min(100, r.paybackPct)}%` }}
                                    />
                                  </div>
                                  <span className="tabular-nums text-xs">{r.paybackPct} %</span>
                                </div>
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
                  ) : (
                    <LoadingState />
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
