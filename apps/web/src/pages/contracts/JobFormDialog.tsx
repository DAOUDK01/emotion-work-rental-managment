import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, ApiError } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { errorMessage, parseHours, type Contract, type ContractJob, type JobWriteBody } from './types';

interface JobForm {
  date: string;
  vehicleRef: string;
  description: string;
  hours: string;
  amount: string;
}

const FORM_ID = 'contract-job-form';

/** Log one repaired vehicle on a contract, or correct a job that is not invoiced yet. */
export function JobFormDialog({
  open,
  contract,
  job,
  onClose,
}: {
  open: boolean;
  contract: Contract;
  /** null = add */
  job: ContractJob | null;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation('contracts');
  const queryClient = useQueryClient();

  const schema = useMemo(
    () =>
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.dateRequired')),
        vehicleRef: z.string().trim().min(1, t('validation.vehicleRequired')).max(120, t('validation.tooLong')),
        description: z.string().trim().min(1, t('validation.descriptionRequired')).max(1000, t('validation.tooLong')),
        hours: z.string().refine((v) => {
          const h = parseHours(v);
          return h === null || (Number.isFinite(h) && h > 0 && h <= 9999.99);
        }, t('validation.hoursInvalid')),
        amount: z.string().refine((v) => {
          const cents = euroInputToCents(v);
          return cents !== null && cents >= 0;
        }, t('validation.amountInvalid')),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<JobForm>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      date: job?.date ?? todayInHelsinki(),
      vehicleRef: job?.vehicleRef ?? '',
      description: job?.description ?? '',
      hours:
        job?.hours != null
          ? job.hours.toLocaleString(i18n.language === 'fi' ? 'fi-FI' : 'en-FI', {
              maximumFractionDigits: 2,
              useGrouping: false,
            })
          : '',
      amount: centsToInput(job?.amountCents),
    });
  }, [open, job, reset, i18n.language]);

  // live "≈ € / h" helper so the agreed hourly rate can be checked at a glance
  const hoursValue = parseHours(watch('hours') ?? '');
  const amountValue = euroInputToCents(watch('amount') ?? '');
  const perHour =
    hoursValue !== null && Number.isFinite(hoursValue) && hoursValue > 0 && amountValue !== null
      ? Math.round(amountValue / hoursValue)
      : null;

  const mutation = useMutation({
    mutationFn: (body: JobWriteBody) =>
      job
        ? api.put<{ job: ContractJob }>(`/contracts/${contract.id}/jobs/${job.id}`, body)
        : api.post<{ job: ContractJob }>(`/contracts/${contract.id}/jobs`, body),
    onSuccess: () => {
      toast.success(job ? t('common:common.savedOk') : t('jobForm.added'));
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'ALREADY_INVOICED') {
        toast.error(t('deleteJob.alreadyInvoiced'));
        void queryClient.invalidateQueries({ queryKey: ['contracts'] });
        onClose();
        return;
      }
      toast.error(errorMessage(err, t('common:common.errorTitle')));
    },
  });

  const onSubmit = handleSubmit((v) => {
    const amountCents = euroInputToCents(v.amount);
    if (amountCents === null) return;
    const hours = parseHours(v.hours);
    mutation.mutate({
      date: v.date,
      vehicleRef: v.vehicleRef.trim(),
      description: v.description.trim(),
      hours: hours !== null && Number.isFinite(hours) ? hours : null,
      amountCents,
    });
  });

  const close = () => {
    if (!mutation.isPending) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title={job ? t('jobForm.editTitle') : t('jobForm.addTitle', { name: contract.name })}
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={mutation.isPending}>
            {mutation.isPending ? t('form.saving') : t('common:action.save')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void onSubmit(e)} className="grid gap-3 sm:grid-cols-2" noValidate>
        <Field label={t('jobs.date')} error={errors.date?.message} required>
          <Input type="date" autoFocus {...register('date')} />
        </Field>
        <Field label={t('jobs.vehicleRef')} error={errors.vehicleRef?.message} required>
          <Input maxLength={120} autoComplete="off" placeholder={t('jobForm.vehicleRefPlaceholder')} {...register('vehicleRef')} />
        </Field>
        <Field label={t('jobs.description')} error={errors.description?.message} required className="sm:col-span-2">
          <Textarea rows={3} maxLength={1000} placeholder={t('jobForm.descriptionPlaceholder')} {...register('description')} />
        </Field>
        <Field
          label={`${t('jobs.hours')} (${t('common:common.optional')})`}
          error={errors.hours?.message}
          hint={t('jobForm.hoursHint')}
        >
          <Input inputMode="decimal" autoComplete="off" placeholder="1,5" {...register('hours')} />
        </Field>
        <Field
          label={t('common:common.amount')}
          error={errors.amount?.message}
          hint={perHour !== null ? t('jobForm.perHour', { amount: fmtEUR(perHour) }) : t('jobForm.amountHint')}
          required
        >
          <Input inputMode="decimal" autoComplete="off" placeholder="0,00" {...register('amount')} />
        </Field>
      </form>
    </Dialog>
  );
}
