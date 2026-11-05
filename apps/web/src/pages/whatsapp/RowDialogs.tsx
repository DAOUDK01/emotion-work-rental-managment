import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import {
  errorMessage,
  FINANCIAL_QUERY_KEYS,
  type RejectResponse,
  type ReparseResponse,
  type WaMessage,
} from './types';

/** Short "what is linked" line for the confirmation dialogs. */
function useLinkedSummary(message: WaMessage | null): string | null {
  const { t } = useTranslation('whatsapp');
  if (!message) return null;
  if (message.entry && message.entry.status !== 'VOID') {
    return t('reject.linkedEntry', {
      id: message.entry.id,
      model: t(`models.${message.entry.model.code}`, { defaultValue: message.entry.model.nameEn }),
      amount: fmtEUR(message.entry.grossCents),
    });
  }
  if (message.expense && message.expense.status !== 'VOID') {
    return t('reject.linkedExpense', {
      id: message.expense.id,
      vendor: message.expense.vendor ?? message.expense.description,
      amount: fmtEUR(message.expense.grossCents),
    });
  }
  return null;
}

/**
 * Reject a message: POST /whatsapp/:id/reject { reason }. The API voids the linked
 * entry/expense (and its auto investments) — the rows are kept as VOID for the audit trail.
 */
export function RejectDialog({ message, onClose }: { message: WaMessage | null; onClose: () => void }) {
  const { t } = useTranslation('whatsapp');
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const linked = useLinkedSummary(message);

  useEffect(() => {
    if (message) {
      setReason('');
      setTouched(false);
    }
  }, [message]);

  const mutation = useMutation({
    mutationFn: ({ id, reason: r }: { id: number; reason: string }) =>
      api.post<RejectResponse>(`/whatsapp/${id}/reject`, { reason: r }),
    onSuccess: () => {
      toast.success(linked ? t('reject.successVoided') : t('reject.success'));
      for (const key of FINANCIAL_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: key });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const trimmed = reason.trim();
  const submit = () => {
    setTouched(true);
    if (!message || !trimmed || mutation.isPending) return;
    mutation.mutate({ id: message.id, reason: trimmed.slice(0, 500) });
  };

  return (
    <ConfirmDialog
      open={message !== null}
      onClose={() => (mutation.isPending ? undefined : onClose())}
      onConfirm={submit}
      title={t('reject.title')}
      message={linked ? t('reject.messageLinked') : t('reject.messageNoLink')}
      confirmLabel={mutation.isPending ? t('reject.rejecting') : t('reject.confirm')}
      busy={mutation.isPending}
    >
      {linked ? (
        <p className="mt-3 rounded-md border border-loss/30 bg-loss/10 px-3 py-2 text-xs font-medium text-loss" role="note">
          {linked}
        </p>
      ) : null}
      {message ? (
        <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
          {message.rawText}
        </pre>
      ) : null}
      <form
        className="mt-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field
          label={t('reject.reason')}
          required
          hint={t('reject.reasonHint')}
          error={touched && !trimmed ? t('validation.reasonRequired') : undefined}
        >
          <Input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder={t('reject.reasonPlaceholder')}
            autoFocus
          />
        </Field>
      </form>
    </ConfirmDialog>
  );
}

/**
 * Re-parse an ERROR / REJECTED message through the same pipeline (POST /whatsapp/:id/reparse).
 * A success creates the entry/expense and the bot replies to the sender again.
 */
export function ReparseDialog({ message, onClose }: { message: WaMessage | null; onClose: () => void }) {
  const { t } = useTranslation('whatsapp');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (id: number) => api.post<ReparseResponse>(`/whatsapp/${id}/reparse`),
    onSuccess: (res) => {
      for (const key of FINANCIAL_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: key });
      if (res.status === 'SAVED') {
        toast.success(t('reparse.saved'), { description: res.reply ?? undefined });
      } else if (res.status === 'RECEIVED') {
        toast.info(t('reparse.replied'), { description: res.reply ?? undefined });
      } else {
        toast.error(t('reparse.notSaved', { status: t(`status.${res.status}`) }), {
          description: res.reply ?? undefined,
        });
      }
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  return (
    <ConfirmDialog
      open={message !== null}
      onClose={() => (mutation.isPending ? undefined : onClose())}
      onConfirm={() => {
        if (message && !mutation.isPending) mutation.mutate(message.id);
      }}
      title={t('reparse.title')}
      message={t('reparse.message')}
      confirmLabel={mutation.isPending ? t('reparse.working') : t('reparse.confirm')}
      destructive={false}
      busy={mutation.isPending}
    >
      {message ? (
        <>
          <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 font-mono text-xs">
            {message.rawText}
          </pre>
          {message.errorText ? (
            <p className="mt-2 whitespace-pre-line text-xs text-loss">
              {t('reparse.lastError')}: {message.errorText}
            </p>
          ) : null}
          <p className="mt-2 text-2xs text-muted-foreground">{t('reparse.allowListNote')}</p>
        </>
      ) : null}
    </ConfirmDialog>
  );
}
