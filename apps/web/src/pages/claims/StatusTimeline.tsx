import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import { statusBadgeVariant, type ClaimStatus } from './types';

/** Position of a status on the OPEN → SUBMITTED → APPROVED/REJECTED → PAID path. */
const STEP_INDEX: Record<ClaimStatus, number> = {
  OPEN: 0,
  SUBMITTED: 1,
  APPROVED: 2,
  REJECTED: 2,
  PAID: 3,
};

/**
 * Status badge plus the claim's progress along OPEN → SUBMITTED → decision → PAID.
 * `compact` (table rows) draws dots; the full variant (detail drawer) spells out every step.
 * A rejected claim ends at the decision step, so the payout step is shown struck out.
 */
export function StatusTimeline({ status, compact }: { status: ClaimStatus; compact?: boolean }) {
  const { t } = useTranslation('claims');
  const current = STEP_INDEX[status];
  const rejected = status === 'REJECTED';

  const steps = [
    t('status.OPEN'),
    t('status.SUBMITTED'),
    rejected ? t('status.REJECTED') : current >= 2 ? t('status.APPROVED') : t('timeline.decision'),
    t('status.PAID'),
  ];
  const label = t('timeline.label', { status: t(`status.${status}`), step: current + 1, steps: steps.length });

  if (compact) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Badge variant={statusBadgeVariant[status]}>{t(`status.${status}`)}</Badge>
        <div className="flex items-center" role="img" aria-label={label} title={steps.join(' → ')}>
          {steps.map((step, i) => (
            <Fragment key={step + String(i)}>
              {i > 0 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-0.5 w-3',
                    i <= current ? (rejected && i === 2 ? 'bg-loss' : 'bg-profit') : 'bg-muted-foreground/25',
                  )}
                />
              ) : null}
              <span
                aria-hidden="true"
                className={cn(
                  'block h-2 w-2 rounded-full border',
                  rejected && i === 3
                    ? 'border-dashed border-muted-foreground/40'
                    : i === current
                      ? rejected
                        ? 'border-loss bg-loss'
                        : 'border-profit bg-profit ring-2 ring-profit/25'
                      : i < current
                        ? 'border-profit bg-profit'
                        : 'border-muted-foreground/40 bg-card',
                )}
              />
            </Fragment>
          ))}
        </div>
      </div>
    );
  }

  return (
    <ol className="flex flex-wrap items-center gap-1 text-xs" aria-label={label}>
      {steps.map((step, i) => (
        <li key={step + String(i)} className="flex items-center gap-1">
          {i > 0 ? <ChevronRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" /> : null}
          {i === current ? (
            <Badge variant={statusBadgeVariant[status]} aria-current="step">
              {step}
            </Badge>
          ) : (
            <span
              className={cn(
                'rounded-full px-2 py-0.5',
                i < current ? 'text-profit' : 'text-muted-foreground',
                rejected && i === 3 && 'line-through opacity-60',
              )}
            >
              {step}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
