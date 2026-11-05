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
} from 'recharts';
import { fmtEURShort, fmtGrowth } from '@/lib/format';

/** Chart components. House rule: the numbers are ALWAYS on the chart (data labels),
 *  not only in tooltips. Green = profit, red = loss. */

export const CHART = {
  navy: '#0b2545',
  teal: '#2a9d8f',
  profit: '#2e7d32',
  loss: '#c62828',
  grey: '#9e9e9e',
  purple: '#6b5bd2',
  orange: '#e76f51',
  series: ['#0b2545', '#2a9d8f', '#6b5bd2', '#e76f51', '#9e9e9e', '#c9a227'],
};

const moneyTip = (value: unknown) => fmtEURShort(Number(value));

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
  const h = height ?? Math.max(120, data.length * 44 + 20);
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 70, top: 4, bottom: 4 }}>
        <XAxis type="number" hide domain={['auto', 'auto']} />
        <YAxis
          type="category"
          dataKey="label"
          width={110}
          tick={{ fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip formatter={moneyTip} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell
              key={i}
              fill={colorBy === 'sign' ? (d.value < 0 ? CHART.loss : CHART.profit) : (color ?? CHART.navy)}
            />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(v: number) => fmtEURShort(v)}
            style={{ fontSize: 11, fill: 'currentColor', fontVariantNumeric: 'tabular-nums' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars with value + growth % labels (growth-by-time chart). */
export function GrowthBars({
  data,
  height = 240,
}: {
  data: Array<{ label: string; valueCents: number; pctChange: number | null }>;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 34, left: 8, right: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip formatter={moneyTip} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        <Bar dataKey="valueCents" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.valueCents < 0 ? CHART.loss : CHART.navy} />
          ))}
          <LabelList
            dataKey="valueCents"
            position="top"
            formatter={(v: number) => fmtEURShort(v)}
            style={{ fontSize: 11, fill: 'currentColor', fontVariantNumeric: 'tabular-nums' }}
          />
          <LabelList
            dataKey="pctChange"
            position="top"
            offset={18}
            formatter={(v: number | null) => (v === null ? '' : fmtGrowth(v))}
            style={{ fontSize: 10, fontWeight: 600 }}
            fill={CHART.teal}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
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
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 22, left: 8, right: 8, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip formatter={moneyTip} cursor={{ fill: 'rgba(0,0,0,0.04)' }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey={aKey} stackId="s" name={aLabel} fill={CHART.navy} maxBarSize={56} isAnimationActive={false} />
        <Bar dataKey={bKey} stackId="s" name={bLabel} fill={CHART.teal} radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={false}>
          <LabelList
            position="top"
            formatter={(_v: number, _n?: unknown, entry?: { payload?: Record<string, number> }) => {
              const p = entry?.payload;
              if (!p) return '';
              const total = Number(p[aKey] ?? 0) + Number(p[bKey] ?? 0);
              return total !== 0 ? fmtEURShort(total) : '';
            }}
            style={{ fontSize: 11, fill: 'currentColor', fontVariantNumeric: 'tabular-nums' }}
          />
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
  const labels = series[0]?.points.map((p) => p.label) ?? [];
  const data = labels.map((label, i) => {
    const row: Record<string, unknown> = { label };
    for (const s of series) row[s.name] = s.points[i]?.valueCents ?? 0;
    return row;
  });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 24, left: 8, right: 24, bottom: 4 }}>
        <CartesianGrid vertical={false} strokeOpacity={0.15} />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} axisLine={false} tickLine={false} />
        <YAxis hide />
        <Tooltip formatter={moneyTip} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color ?? CHART.series[i % CHART.series.length]}
            strokeWidth={2}
            dot={{ r: 3 }}
            isAnimationActive={false}
          >
            <LabelList
              dataKey={s.name}
              position="top"
              formatter={(v: number) => (v !== 0 ? fmtEURShort(v) : '')}
              style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}
            />
          </Line>
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
