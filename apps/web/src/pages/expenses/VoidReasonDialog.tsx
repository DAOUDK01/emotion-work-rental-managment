import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';

/** Destructive confirmation that requires a reason (sent as `{ reason }` to the void endpoints). */
export function VoidReasonDialog({
  open,
  title,
  message,
  defaultReason = '',
  busy,
  onClose,
  onConfirm,
  children,
}: {
  open: boolean;
  title: string;
  message: string;
  defaultReason?: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation('expenses');
  const [reason, setReason] = useState(defaultReason);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(defaultReason);
      setTouched(false);
    }
  }, [open, defaultReason]);

  const trimmed = reason.trim();
  return (
    <ConfirmDialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      onConfirm={() => {
        setTouched(true);
        if (trimmed) onConfirm(trimmed.slice(0, 500));
      }}
      title={title}
      message={message}
      confirmLabel={busy ? t('void.voiding') : t('common:action.void')}
      busy={busy}
    >
      {children}
      <form
        className="mt-3"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (trimmed && !busy) onConfirm(trimmed.slice(0, 500));
        }}
      >
        <Field label={t('void.reason')} required error={touched && !trimmed ? t('validation.reasonRequired') : undefined}>
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
