import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { VoidReasonDialog } from './VoidReasonDialog';
import { errorMessage, type ExpenseDuplicate } from './types';

/**
 * Shown right after POST /expenses returned possible duplicates.
 * Keep = continue (receipt step). Void = confirm with a reason, then void the NEW expense.
 */
export function DuplicateWarningDialog({
  expenseId,
  duplicates,
  onKeep,
  onVoided,
}: {
  expenseId: number;
  duplicates: ExpenseDuplicate[];
  onKeep: () => void;
  onVoided: () => void;
}) {
  const { t } = useTranslation('expenses');
  const [confirming, setConfirming] = useState(false);

  const voidNew = useMutation({
    mutationFn: (reason: string) => api.post<unknown>(`/expenses/${expenseId}/void`, { reason }),
    onSuccess: () => {
      toast.success(t('common:common.voidedOk'));
      setConfirming(false);
      onVoided();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  if (confirming) {
    return (
      <VoidReasonDialog
        open
        title={t('duplicates.confirmTitle')}
        message={t('duplicates.confirmMessage', { id: expenseId })}
        defaultReason={t('duplicates.defaultReason', { ids: duplicates.map((d) => `#${d.id}`).join(', ') })}
        busy={voidNew.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={(reason) => voidNew.mutate(reason)}
      />
    );
  }

  return (
    <Dialog
      open
      onClose={onKeep}
      title={t('duplicates.title')}
      wide
      footer={
        <>
          <Button variant="destructive" onClick={() => setConfirming(true)}>
            {t('duplicates.voidNew')}
          </Button>
          <Button onClick={onKeep} autoFocus>
            {t('duplicates.keep')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="flex items-start gap-2 text-sm">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          {t('duplicates.message', { count: duplicates.length, id: expenseId })}
        </p>
        <Table>
          <THead>
            <TR>
              <TH>{t('duplicates.expense')}</TH>
              <TH>{t('common:common.date')}</TH>
              <TH>{t('columns.vendor')}</TH>
              <TH className="text-right">{t('columns.gross')}</TH>
            </TR>
          </THead>
          <TBody>
            {duplicates.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">#{d.id}</TD>
                <TD className="whitespace-nowrap">{d.expenseDate ? fmtDate(d.expenseDate) : t('table.noDate')}</TD>
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
