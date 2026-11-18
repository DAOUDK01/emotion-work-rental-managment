import { useTranslation } from 'react-i18next';
import { periodRange, todayInHelsinki, type ISODate } from '@emotionfix/shared';
import { Segmented } from '@/components/ui/misc';
import { Input, Label } from '@/components/ui/input';
import { CalendarDays } from 'lucide-react';
import { fmtDate } from '@/lib/format';

export type PeriodKind = 'week' | 'month' | 'year' | 'custom';

export interface Period {
  kind: PeriodKind;
  from: ISODate;
  to: ISODate;
}

export function defaultPeriod(kind: Exclude<PeriodKind, 'custom'> = 'month'): Period {
  const { from, to } = periodRange(kind, todayInHelsinki());
  return { kind, from, to };
}

/** Week / Month / Year / Custom dates — the PDF's period buttons. */
export function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useTranslation('common');
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Segmented
        value={value.kind}
        onChange={(kind) => {
          if (kind === 'custom') onChange({ ...value, kind });
          else onChange(defaultPeriod(kind));
        }}
        options={[
          { value: 'week' as const, label: t('period.week') },
          { value: 'month' as const, label: t('period.month') },
          { value: 'year' as const, label: t('period.year') },
          { value: 'custom' as const, label: t('period.custom') },
        ]}
      />
      {value.kind === 'custom' ? (
        <div className="flex items-end gap-2">
          <div>
            <Label htmlFor="period-from">{t('period.from')}</Label>
            <Input
              id="period-from"
              type="date"
              className="h-8 w-36"
              value={value.from}
              max={value.to}
              onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="period-to">{t('period.to')}</Label>
            <Input
              id="period-to"
              type="date"
              className="h-8 w-36"
              value={value.to}
              min={value.from}
              onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <span className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs font-medium text-muted-foreground shadow-xs tabular-nums">
          <CalendarDays className="h-3.5 w-3.5" />
          {fmtDate(value.from)} – {fmtDate(value.to)}
        </span>
      )}
    </div>
  );
}
