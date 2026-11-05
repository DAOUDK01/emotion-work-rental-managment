import { useTranslation } from 'react-i18next';
import { periodRange, todayInHelsinki, type ISODate } from '@emotionfix/shared';
import { Segmented } from '@/components/ui/misc';
import { Input, Label } from '@/components/ui/input';

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
        <span className="pb-1.5 text-xs text-muted-foreground tabular-nums">
          {value.from} — {value.to}
        </span>
      )}
    </div>
  );
}
