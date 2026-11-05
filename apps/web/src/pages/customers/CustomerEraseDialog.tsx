import { useEffect, useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { parseOutstandingDetails, type Customer } from './types';

const CONFIRM_WORD = 'ERASE';

/**
 * GDPR right-to-erasure (ADMIN). Personal fields are anonymised; financial rows
 * stay (Finnish Bookkeeping Act: 6-year retention). The admin must type ERASE.
 */
export default function CustomerEraseDialog({
  open,
  onClose,
  customer,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer;
}) {
  const { t } = useTranslation('customers');
  const queryClient = useQueryClient();
  const hintId = useId();
  const [typed, setTyped] = useState('');
  const [inputError, setInputError] = useState<string | undefined>();
  const [blocked, setBlocked] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped('');
      setInputError(undefined);
      setBlocked(null);
    }
  }, [open]);

  const erase = useMutation({
    mutationFn: () => api.post<{ customer: Customer }>(`/gdpr/customers/${customer.id}/erase`, { confirm: true }),
    onSuccess: () => {
      toast.success(t('gdpr.erasedOk'));
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['lookups'] });
      onClose();
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'HAS_OUTSTANDING') {
        const d = parseOutstandingDetails(err.details);
        const message = d
          ? t('gdpr.hasOutstandingDetail', {
              amount: fmtEUR(d.outstandingCents),
              entries: d.openEntries,
              invoices: d.unpaidInvoices,
            })
          : t('gdpr.hasOutstanding');
        setBlocked(message);
        toast.error(t('gdpr.hasOutstanding'));
        return;
      }
      toast.error(err.message);
    },
  });

  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={() => {
        if (typed.trim() !== CONFIRM_WORD) {
          setInputError(t('gdpr.typeToConfirmError', { word: CONFIRM_WORD }));
          return;
        }
        erase.mutate();
      }}
      title={t('gdpr.eraseTitle', { name: customer.name })}
      message={t('gdpr.eraseMessage')}
      confirmLabel={t('gdpr.eraseConfirm')}
      busy={erase.isPending}
    >
      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>{t('gdpr.eraseRemoves')}</li>
        <li>{t('gdpr.eraseKeeps')}</li>
        <li>{t('gdpr.eraseIrreversible')}</li>
      </ul>
      {blocked ? (
        <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">
          {blocked}
        </p>
      ) : null}
      <div className="mt-3">
        <Field
          label={t('gdpr.typeToConfirm', { word: CONFIRM_WORD })}
          error={inputError}
          required
        >
          <Input
            value={typed}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={hintId}
            placeholder={CONFIRM_WORD}
            onChange={(e) => {
              setTyped(e.target.value);
              setInputError(undefined);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (typed.trim() === CONFIRM_WORD && !erase.isPending) erase.mutate();
                else setInputError(t('gdpr.typeToConfirmError', { word: CONFIRM_WORD }));
              }
            }}
          />
        </Field>
        <p id={hintId} className="mt-1 text-2xs text-muted-foreground">
          {t('gdpr.typeToConfirmHint')}
        </p>
      </div>
    </ConfirmDialog>
  );
}
