import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { StatusTimeline } from './StatusTimeline';
import {
  CLAIM_STATUSES,
  errorMessage,
  isDecided,
  needsApprovedAmount,
  type Claim,
  type ClaimResponse,
  type ClaimStatus,
  type ClaimStatusBody,
} from './types';

interface StatusForm {
  status: ClaimStatus;
  approved: string;
  date: string;
}

const FORM_ID = 'claim-status-form';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Next status in the usual flow — preselected to save a click. */
function suggestedNext(status: ClaimStatus): ClaimStatus {
  switch (status) {
    case 'OPEN':
      return 'SUBMITTED';
    case 'SUBMITTED':
      return 'APPROVED';
    case 'APPROVED':
      return 'PAID';
    default:
      return status;
  }
}

/**
 * Move a claim along OPEN → SUBMITTED → APPROVED/REJECTED → PAID (free-form; every change audited).
 * APPROVED/PAID need the approved amount; decisions record a decision date (today when left empty),
 * SUBMITTED records the submission date on the claim.
 */
export function ClaimStatusDialog({ claim, onClose }: { claim: Claim | null; onClose: () => void }) {
  const { t } = useTranslation('claims');
  const queryClient = useQueryClient();
  const open = claim !== null;

  const schema = useMemo(
    () =>
      z
        .object({
          status: z.enum(CLAIM_STATUSES),
          approved: z.string(),
          date: z.string(),
        })
        .superRefine((v, ctx) => {
          if (needsApprovedAmount(v.status)) {
            const cents = v.approved.trim() === '' ? null : euroInputToCents(v.approved);
            if (cents === null || cents < 0) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['approved'],
                message: v.approved.trim() === '' ? t('validation.approvedRequired') : t('validation.amountInvalid'),
              });
            }
          }
          if (v.date !== '' && !ISO.test(v.date)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date'], message: t('validation.dateInvalid') });
          }
          if (v.status === 'SUBMITTED' && v.date === '') {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['date'], message: t('validation.submittedRequired') });
          }
        }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors },
  } = useForm<StatusForm>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!claim) return;
    const next = suggestedNext(claim.status);
    reset({
      status: next,
      approved: centsToInput(claim.approvedCents ?? claim.claimedCents),
      date: next === 'SUBMITTED' ? (claim.submittedAt ?? todayInHelsinki()) : (claim.decidedAt ?? todayInHelsinki()),
    });
  }, [claim, reset]);

  const status = watch('status');

  const mutation = useMutation({
    mutationFn: async (v: StatusForm) => {
      if (!claim) throw new Error(t('common:common.errorTitle'));
      const body: ClaimStatusBody = { status: v.status };
      if (needsApprovedAmount(v.status)) body.approvedCents = euroInputToCents(v.approved);
      if (isDecided(v.status) && v.date) body.decidedAt = v.date;
      let res = await api.post<ClaimResponse>(`/claims/${claim.id}/status`, body);
      // the status endpoint does not carry the submission date — record it on the claim itself
      if (v.status === 'SUBMITTED' && v.date && v.date !== res.claim.submittedAt) {
        res = await api.put<ClaimResponse>(`/claims/${claim.id}`, { submittedAt: v.date });
      }
      return res;
    },
    onSuccess: (res) => {
      toast.success(
        t('statusDialog.success', { caseNumber: res.claim.caseNumber, status: t(`status.${res.claim.status}`) }),
      );
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const close = () => {
    if (!mutation.isPending) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('statusDialog.title', { caseNumber: claim?.caseNumber ?? '' })}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={mutation.isPending}>
            {mutation.isPending ? t('statusDialog.saving') : t('statusDialog.submit')}
          </Button>
        </>
      }
    >
      {claim ? (
        <form
          id={FORM_ID}
          onSubmit={(e) => void handleSubmit((v) => mutation.mutate(v))(e)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
            <p className="text-2xs font-semibold uppercase text-muted-foreground">{t('statusDialog.current')}</p>
            <StatusTimeline status={claim.status} />
            <p className="text-xs text-muted-foreground">
              {claim.company} · {t('table.claimed')} {fmtEUR(claim.claimedCents)}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('statusDialog.newStatus')} error={errors.status?.message} required className="sm:col-span-2">
              <Select
                autoFocus
                {...register('status', {
                  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
                    const next = e.target.value as ClaimStatus;
                    // the date field means "submitted on" or "decided on" depending on the status
                    setValue(
                      'date',
                      next === 'SUBMITTED'
                        ? (claim?.submittedAt ?? todayInHelsinki())
                        : (claim?.decidedAt ?? todayInHelsinki()),
                    );
                  },
                })}
              >
                {CLAIM_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`status.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            {needsApprovedAmount(status) ? (
              <Field
                label={t('statusDialog.approved')}
                error={errors.approved?.message}
                hint={t('statusDialog.approvedHint')}
                required
              >
                <Input inputMode="decimal" autoComplete="off" placeholder="0,00" {...register('approved')} />
              </Field>
            ) : null}
            {isDecided(status) ? (
              <Field label={t('statusDialog.decidedAt')} error={errors.date?.message} hint={t('statusDialog.decidedHint')}>
                <Input type="date" max={todayInHelsinki()} {...register('date')} />
              </Field>
            ) : null}
            {status === 'SUBMITTED' ? (
              <Field label={t('statusDialog.submittedAt')} error={errors.date?.message} required>
                <Input type="date" max={todayInHelsinki()} {...register('date')} />
              </Field>
            ) : null}
          </div>
          {status === 'REJECTED' ? (
            <p className="rounded-md bg-loss/10 px-3 py-2 text-xs text-loss">{t('statusDialog.rejectedNote')}</p>
          ) : null}
        </form>
      ) : null}
    </Dialog>
  );
}
