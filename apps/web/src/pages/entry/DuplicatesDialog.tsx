import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import type { ExpenseDuplicate } from './types';

/**
 * "Possible duplicate" warning after POST /expenses returned matches.
 * Keep = just close. Void = confirm with a reason, then POST /expenses/:id/void on the NEW expense.
 */
export function DuplicatesDialog({
  state,
  onClose,
  onVoided,
}: {
  state: { expenseId: number; duplicates: ExpenseDuplicate[] } | null;
  onClose: () => void;
  onVoided: (expenseId: number) => void;
}) {
  const { t } = useTranslation('entry');
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (!state) return;
    setConfirming(false);
    setReason(t('duplicates.defaultReason', { ids: state.duplicates.map((d) => `#${d.id}`).join(', ') }));
  }, [state, t]);

  const voidExpense = useMutation({
    mutationFn: ({ id, why }: { id: number; why: string }) => api.post<unknown>(`/expenses/${id}/void`, { reason: why }),
    onSuccess: (_res, { id }) => {
      toast.success(t('common:common.voidedOk'));
      setConfirming(false);
      onVoided(id);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('common:common.errorTitle')),
  });

  if (!state) return null;

  if (confirming) {
    const trimmed = reason.trim();
    return (
      <ConfirmDialog
        open
        onClose={() => (voidExpense.isPending ? undefined : setConfirming(false))}
        onConfirm={() => {
          if (trimmed) voidExpense.mutate({ id: state.expenseId, why: trimmed.slice(0, 500) });
        }}
        title={t('duplicates.confirmTitle')}
        message={t('duplicates.confirmMessage', { id: state.expenseId })}
        confirmLabel={t('duplicates.voidNew')}
        busy={voidExpense.isPending}
      >
        <div className="mt-3">
          <Field label={t('duplicates.reason')} required error={trimmed ? undefined : t('validation.reasonRequired')}>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              aria-label={t('duplicates.reason')}
              autoFocus
            />
          </Field>
        </div>
      </ConfirmDialog>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('duplicates.title')}
      wide
      footer={
        <>
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            {t('duplicates.voidNew')}
          </Button>
          <Button onClick={onClose} autoFocus>
            {t('duplicates.keep')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          {t('duplicates.message', { count: state.duplicates.length, id: state.expenseId })}
        </p>
        <Table>
          <THead>
            <TR>
              <TH>{t('duplicates.expense')}</TH>
              <TH>{t('common:common.date')}</TH>
              <TH>{t('fields.vendor')}</TH>
              <TH className="text-right">{t('table.gross')}</TH>
            </TR>
          </THead>
          <TBody>
            {state.duplicates.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">#{d.id}</TD>
                <TD className="whitespace-nowrap">{d.expenseDate ? fmtDate(d.expenseDate) : t('duplicates.noDate')}</TD>
                <TD>{d.vendor ?? '–'}</TD>
                <TDMoney>{fmtEUR(d.grossCents)}</TDMoney>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </Dialog>
  );
}
