import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import type { HolderKind, LedgerKind } from './types';

/** Small chip naming the kind of money holder (Partner / Company / Cash box / Other). */
export function KindChip({ kind }: { kind: HolderKind }) {
  const { t } = useTranslation('cash');
  const variant = kind === 'COMPANY' ? 'navy' : kind === 'PARTNER' ? 'info' : kind === 'CASHBOX' ? 'warning' : 'outline';
  return <Badge variant={variant}>{t(`kind.${kind}`)}</Badge>;
}

/** Ledger movement badge: receipt in, handover out, handover in. */
export function LedgerKindBadge({ kind }: { kind: LedgerKind }) {
  const { t } = useTranslation('cash');
  const variant = kind === 'RECEIPT' ? 'success' : kind === 'HANDOVER_OUT' ? 'warning' : 'info';
  return <Badge variant={variant}>{t(`ledger.kind.${kind}`)}</Badge>;
}

/** Previous / next pagination, shown only when there is more than one page. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation('cash');
  if (total <= pageSize) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <nav className="flex items-center justify-end gap-2 pt-3" aria-label={t('pager.label')}>
      <span className="text-xs tabular-nums text-muted-foreground">
        {t('common:common.page')} {page} {t('common:common.of')} {pages}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label={t('pager.previous')}
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label={t('pager.next')}
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </nav>
  );
}

/** Destructive confirmation that requires a reason (sent as `{ reason }` to the void endpoint). */
export function VoidReasonDialog({
  open,
  title,
  message,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation('cash');
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const trimmed = reason.trim();
  const submit = () => {
    setTouched(true);
    if (trimmed && !busy) onConfirm(trimmed.slice(0, 500));
  };

  return (
    <ConfirmDialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      onConfirm={submit}
      title={title}
      message={message}
      confirmLabel={busy ? t('void.voiding') : t('common:action.void')}
      busy={busy}
    >
      <form
        className="mt-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={t('void.reason')} required error={touched && !trimmed ? t('void.reasonRequired') : undefined}>
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={t('void.reasonPlaceholder')}
            aria-label={t('void.reason')}
            autoFocus
          />
        </Field>
      </form>
    </ConfirmDialog>
  );
}
