import { useId } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts';
import { ChartNoAxesColumn } from 'lucide-react';
import { fmtEURShort, fmtGrowth } from '@/lib/format';
import i18n from '@/lib/i18n';

/** Chart components. House rule: the numbers are ALWAYS on the chart (data labels),
 *  not only in tooltips. Green = profit, red = loss. Colours are design tokens, so the
 *  charts follow light/dark mode. */

const v = (name: string) => `hsl(var(--${name}))`;

export const CHART = {
  navy: v('chart-1'),
  teal: v('chart-2'),
  profit: v('profit'),
  loss: v('loss'),
  grey: v('muted-foreground'),
  purple: v('chart-3'),
  orange: v('chart-4'),
  series: [v('chart-1'), v('chart-2'), v('chart-3'), v('chart-4'), v('chart-5'), v('chart-6')],
};

/** Map the historical brand hex values (pages, model colours stored in the DB) onto the
 *  theme tokens so they stay readable in dark mode. Other colours pass through unchanged. */
const LEGACY: Record<string, string> = {
  '#0b2545': CHART.navy,
  '#2a9d8f': CHART.teal,
  '#6b5bd2': CHART.purple,
  '#e76f51': CHART.orange,
  '#2e7d32': CHART.profit,
  '#c62828': CHART.loss,
  '#9e9e9e': CHART.grey,
};
export function chartColor(c: string | null | undefined, fallback: string = CHART.navy): string {
  if (!c) return fallback;
  return LEGACY[c.toLowerCase()] ?? c;
}

const AXIS_TICK = { fontSize: 12, fill: v('muted-foreground') };
const VALUE_LABEL = {
  fontSize: 11,
  fontWeight: 600,
  fill: v('foreground'),
  fontVariantNumeric: 'tabular-nums',
} as const;
const CURSOR = { fill: 'hsl(var(--muted-foreground) / 0.07)' };

/** Elevated tooltip card used by every chart. */
function ChartTooltip({
  active,
  payload,
  label,
  hideNames,
}: TooltipProps<number, string> & { hideNames?: boolean }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== undefined && p.value !== null);
  return (
    <div className="min-w-[8rem] rounded-lg border border-border/80 bg-card/95 px-3 py-2 text-xs shadow-elevated backdrop-blur">
      {label !== undefined && label !== '' ? (
        <div className="mb-1 font-semibold text-foreground">{String(label)}</div>
      ) : null}
      <div className="space-y-0.5">
        {rows.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background:
                    (p.payload as { __color?: string } | undefined)?.__color ??
                    (p.color as string | undefined) ??
                    CHART.navy,
                }}
              />
              {hideNames ? null : p.name}
            </span>
            <span className="font-semibold tabular-nums text-foreground">
              {fmtEURShort(Number(p.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Calm placeholder when a chart has nothing to show for the chosen filters. */
export function ChartEmpty({ height = 160, label }: { height?: number; label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface/40 text-center"
      style={{ height }}
    >
      <ChartNoAxesColumn className="h-6 w-6 text-muted-foreground/60" />
      <p className="text-xs text-muted-foreground">
        {label ?? i18n.t('common:common.noChartData')}
      </p>
    </div>
  );
}

/** Non-breaking spaces so Recharts never wraps a value label ("−100 %") onto two lines. */
const nb = (s: string) => s.replace(/ /g, ' ');

const allZero = (values: number[]) => values.length === 0 || values.every((x) => !x);

/** Horizontal bars with value labels (Revenue by model, P&L by model). */
export function HBars({
  data,
  color,
  colorBy,
  height,
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
  colorBy?: 'sign';
  height?: number;
}) {
  const uid = useId().replace(/:/g, '');
  const h = height ?? Math.max(120, data.length * 46 + 16);
  if (allZero(data.map((d) => d.value))) return <ChartEmpty height={Math.min(h, 180)} />;
  const base = chartColor(color);
  const fills = {
    base: `url(#hb-${uid}-base)`,
    pos: `url(#hb-${uid}-pos)`,
    neg: `url(#hb-${uid}-neg)`,
  };
  const grad = (id: string, c: string) => (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor={c} stopOpacity={0.7} />
      <stop offset="100%" stopColor={c} stopOpacity={1} />
    </linearGradient>
  );
  const rows = data.map((d) => ({
    ...d,
    __color: colorBy === 'sign' ? (d.value < 0 ? CHART.loss : CHART.profit) : base,
  }));
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 72, top: 4, bottom: 4 }}>
        <defs>
          {grad(`hb-${uid}-base`, base)}
          {grad(`hb-${uid}-pos`, CHART.profit)}
          {grad(`hb-${uid}-neg`, CHART.loss)}
        </defs>
        <XAxis type="number" hide domain={['auto', 'auto']} />
        <YAxis
          type="category"
          dataKey="label"
          width={116}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<ChartTooltip hideNames />} cursor={CURSOR} />
        <Bar
          dataKey="value"
          radius={[0, 6, 6, 0]}
          barSize={18}
          isAnimationActive={false}
          background={{ fill: 'hsl(var(--muted) / 0.9)', radius: 6 } as unknown as object}
        >
          {rows.map((d, i) => (
            <Cell
              key={i}
              fill={colorBy === 'sign' ? (d.value < 0 ? fills.neg : fills.pos) : fills.base}
            />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            offset={8}
            formatter={(val: number) => nb(fmtEURShort(val))}
            style={VALUE_LABEL}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars with value + growth % labels (growth-by-time chart). */
export function GrowthBars({
  data,
  height = 260,
}: {
  data: Array<{ label: string; valueCents: number; pctChange: number | null }>;
  height?: number;
}) {
  const uid = useId().replace(/:/g, '');
  if (allZero(data.map((d) => d.valueCents))) return <ChartEmpty height={height} />;
  const rows = data.map((d) => ({ ...d, __color: d.valueCents < 0 ? CHART.loss : CHART.navy }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 40, left: 8, right: 8, bottom: 4 }}>
        <defs>
          <linearGradient id={`gb-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.navy} stopOpacity={1} />
            <stop offset="100%" stopColor={CHART.navy} stopOpacity={0.55} />
          </linearGradient>
          <linearGradient id={`gb-${uid}-neg`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CHART.loss} stopOpacity={0.6} />
            <stop offset="100%" stopColor={CHART.loss} stopOpacity={1} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={v('chart-grid')} strokeDasharray="4 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} dy={4} />
        <YAxis hide />
        <Tooltip content={<ChartTooltip hideNames />} cursor={CURSOR} />
        <Bar
          dataKey="valueCents"
          radius={[8, 8, 3, 3]}
          maxBarSize={56}
          isAnimationActive={false}
        >
          {rows.map((d, i) => (
            <Cell key={i} fill={d.valueCents < 0 ? `url(#gb-${uid}-neg)` : `url(#gb-${uid})`} />
          ))}
          <LabelList
            dataKey="valueCents"
            position="top"
            formatter={(val: number) => nb(fmtEURShort(val))}
            style={VALUE_LABEL}
          />
          <LabelList
            dataKey="pctChange"
            position="top"
            offset={20}
            formatter={(val: number | null) => (val === null ? '' : nb(fmtGrowth(val)))}
            style={{ fontSize: 10.5, fontWeight: 700 }}
            fill={CHART.teal}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function legendText(value: string) {
  return <span className="text-xs text-muted-foreground">{value}</span>;
}

/** Stacked received/outstanding bars (monthly trend, rental by category). */
export function StackedBars({
  data,
  aKey = 'receivedCents',
  bKey = 'outstandingCents',
  aLabel,
  bLabel,
  height = 240,
}: {
  data: Array<Record<string, unknown> & { label: string }>;
  aKey?: string;
  bKey?: string;
  aLabel: string;
  bLabel: string;
  height?: number;
}) {
  // The stack total sits on top of the outstanding bar, or on the received bar when nothing
  // is outstanding (a zero-height bar draws no label).
  const totalLabel =
    (onReceived: boolean) =>
    (entry: { payload?: Record<string, unknown> }): string => {
      const p = entry.payload;
      if (!p) return '';
      const b = Number(p[bKey] ?? 0);
      if (onReceived !== (b === 0)) return '';
      const total = Number(p[aKey] ?? 0) + b;
      return total !== 0 ? nb(fmtEURShort(total)) : '';
    };
  if (allZero(data.map((d) => Number(d[aKey] ?? 0) + Number(d[bKey] ?? 0)))) {
    return <ChartEmpty height={height} />;
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 24, left: 8, right: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={v('chart-grid')} strokeDasharray="4 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} dy={4} />
        <YAxis hide />
        <Tooltip content={<ChartTooltip />} cursor={CURSOR} />
        <Legend iconType="circle" iconSize={8} formatter={legendText} wrapperStyle={{ paddingTop: 8 }} />
        <Bar
          dataKey={aKey}
          stackId="s"
          name={aLabel}
          fill={CHART.navy}
          maxBarSize={48}
          radius={[0, 0, 3, 3]}
          isAnimationActive={false}
        >
          <LabelList position="top" valueAccessor={totalLabel(true)} style={VALUE_LABEL} />
        </Bar>
        <Bar
          dataKey={bKey}
          stackId="s"
          name={bLabel}
          fill={CHART.teal}
          radius={[6, 6, 0, 0]}
          maxBarSize={48}
          isAnimationActive={false}
        >
          <LabelList position="top" valueAccessor={totalLabel(false)} style={VALUE_LABEL} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Multi-model comparison lines with labelled points. */
export function CompareLines({
  series,
  height = 280,
}: {
  series: Array<{ name: string; color?: string | null; points: Array<{ label: string; valueCents: number }> }>;
  height?: number;
}) {
  if (allZero(series.flatMap((s) => s.points.map((p) => p.valueCents)))) {
    return <ChartEmpty height={height} />;
  }
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const data = labels.map((label, i) => {
    const row: Record<string, unknown> = { label };
    for (const s of series) row[s.name] = s.points[i]?.valueCents ?? 0;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 26, left: 12, right: 28, bottom: 4 }}>
        <CartesianGrid vertical={false} stroke={v('chart-grid')} strokeDasharray="4 4" />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} dy={4} />
        <YAxis hide />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: v('border') }} />
        <Legend iconType="circle" iconSize={8} formatter={legendText} wrapperStyle={{ paddingTop: 8 }} />
        {series.map((s, i) => {
          const c = chartColor(s.color, CHART.series[i % CHART.series.length]);
          return (
            <Line
              key={s.name}
              type="monotone"
              dataKey={s.name}
              stroke={c}
              strokeWidth={2.25}
              dot={{ r: 3.5, strokeWidth: 2, fill: v('card'), stroke: c }}
              activeDot={{ r: 5, strokeWidth: 0, fill: c }}
              isAnimationActive={false}
            >
              <LabelList
                dataKey={s.name}
                position="top"
                offset={10}
                formatter={(val: number) => (val !== 0 ? nb(fmtEURShort(val)) : '')}
                style={{ fontSize: 10, fontWeight: 600, fill: c, fontVariantNumeric: 'tabular-nums' }}
              />
            </Line>
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
