import { useTranslation } from 'react-i18next';
import { CheckCircle2, X } from 'lucide-react';
import { fmtEUR, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { modelLabel, type EntryListItem, type UnitPayback } from './types';

/** Success panel after POST /entries — shows the unit's payback status when the API returns it. */
export function IncomeSuccess({
  entry,
  unitPayback,
  onClose,
}: {
  entry: EntryListItem;
  unitPayback: UnitPayback | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('entry');
  const p = unitPayback;

  let paybackText: string | null = null;
  if (p) {
    if (p.costCents === null) {
      paybackText = t('income.success.paybackNoCost', { code: p.code, earned: fmtEUR(p.earnedCents) });
    } else if (p.remainingCents !== null && p.remainingCents > 0) {
      paybackText =
        p.paybackPct !== null
          ? t('income.success.paybackRemainingPct', {
              code: p.code,
              amount: fmtEUR(p.remainingCents),
              pct: fmtPct(p.paybackPct, 0),
            })
          : t('income.success.paybackRemaining', { code: p.code, amount: fmtEUR(p.remainingCents) });
    } else {
      paybackText = t('income.success.paidBack', { code: p.code, earned: fmtEUR(p.earnedCents) });
    }
  }

  return (
    <div className="flex items-start gap-3 rounded-lg border border-profit/40 bg-profit/10 p-3 text-sm" role="status">
      <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-profit" aria-hidden />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="font-semibold text-profit">
          {t('income.success.title', { amount: fmtEUR(entry.grossCents), model: modelLabel(entry.model, i18n.language) })}
        </p>
        {paybackText ? <p className="text-foreground/90">{paybackText}</p> : null}
        {entry.needsReview ? (
          <p className="text-xs text-amber-700 dark:text-amber-400" title={entry.reviewReason ?? undefined}>
            {t('income.success.needsReview')}
          </p>
        ) : null}
      </div>
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t('common:action.close')}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
