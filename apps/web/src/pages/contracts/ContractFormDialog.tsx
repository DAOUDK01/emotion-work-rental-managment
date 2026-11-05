import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, ApiError, qs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import {
  errorMessage,
  type BusinessCustomer,
  type Contract,
  type ContractWriteBody,
} from './types';

interface ContractForm {
  customerId: string;
  name: string;
  terms: string;
  startDate: string;
  endDate: string;
  active: boolean;
}

const FORM_ID = 'contract-form';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Create / edit a maintenance contract. Only BUSINESS customers can hold one (API: 400 NOT_BUSINESS). */
export function ContractFormDialog({
  open,
  contract,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create */
  contract: Contract | null;
  onClose: () => void;
  onSaved?: (contract: Contract) => void;
}) {
  const { t } = useTranslation('contracts');
  const queryClient = useQueryClient();

  const customers = useQuery({
    queryKey: ['customers', 'list', 'business-options'],
    queryFn: () =>
      api.get<{ customers: BusinessCustomer[] }>('/customers' + qs({ type: 'BUSINESS', archived: 'false', pageSize: 200 })),
    enabled: open,
    staleTime: 60_000,
  });

  const options = useMemo(() => {
    const list = customers.data?.customers ?? [];
    const current = contract?.customer;
    if (current && !list.some((c) => c.id === current.id)) {
      return [{ id: current.id, name: current.name, type: current.type, businessId: current.businessId }, ...list];
    }
    return list;
  }, [customers.data, contract]);

  const schema = useMemo(
    () =>
      z
        .object({
          customerId: z.string().min(1, t('validation.customerRequired')),
          name: z.string().trim().min(1, t('validation.nameRequired')).max(200, t('validation.tooLong')),
          terms: z.string().max(10000, t('validation.tooLong')),
          startDate: z.string().regex(ISO, t('validation.startRequired')),
          endDate: z.string().refine((v) => v === '' || ISO.test(v), t('validation.dateInvalid')),
          active: z.boolean(),
        })
        .refine((v) => v.endDate === '' || v.endDate >= v.startDate, {
          path: ['endDate'],
          message: t('validation.endBeforeStart'),
        }),
    [t],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    watch,
    formState: { errors },
  } = useForm<ContractForm>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      customerId: contract ? String(contract.customerId) : '',
      name: contract?.name ?? '',
      terms: contract?.terms ?? '',
      startDate: contract?.startDate ?? todayInHelsinki(),
      endDate: contract?.endDate ?? '',
      active: contract?.active ?? true,
    });
  }, [open, contract, reset]);

  const selected = options.find((c) => String(c.id) === watch('customerId'));
  const selectedNotBusiness = selected !== undefined && selected.type !== 'BUSINESS';

  const mutation = useMutation({
    mutationFn: (body: ContractWriteBody) =>
      contract
        ? api.put<{ contract: Contract }>(`/contracts/${contract.id}`, body)
        : api.post<{ contract: Contract }>('/contracts', body),
    onSuccess: (res) => {
      toast.success(contract ? t('common:common.savedOk') : t('form.created', { name: res.contract.name }));
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
      onSaved?.(res.contract);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'NOT_BUSINESS') {
        setError('customerId', { message: t('form.notBusiness') });
        return;
      }
      if (err instanceof ApiError && err.code === 'BAD_PERIOD') {
        setError('endDate', { message: t('validation.endBeforeStart') });
        return;
      }
      toast.error(errorMessage(err, t('common:common.errorTitle')));
    },
  });

  const onSubmit = handleSubmit((v) => {
    const terms = v.terms.trim();
    mutation.mutate({
      customerId: Number(v.customerId),
      name: v.name.trim(),
      terms: terms === '' ? null : terms,
      startDate: v.startDate,
      endDate: v.endDate || null,
      active: v.active,
    });
  });

  const close = () => {
    if (!mutation.isPending) onClose();
  };
  const noBusinessCustomers = customers.isSuccess && options.length === 0;

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title={contract ? t('form.editTitle', { name: contract.name }) : t('form.createTitle')}
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
        <Field
          label={t('form.customer')}
          error={errors.customerId?.message}
          hint={customers.isError ? t('form.customersFailed') : t('form.customerHint')}
          required
        >
          <Select autoFocus disabled={customers.isLoading} {...register('customerId')}>
            <option value="">{customers.isLoading ? t('form.loadingCustomers') : t('form.chooseCustomer')}</option>
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.businessId ? ` (${c.businessId})` : ''}
                {c.type !== 'BUSINESS' ? ` — ${t('form.notBusinessShort')}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('form.name')} error={errors.name?.message} required>
          <Input maxLength={200} placeholder={t('form.namePlaceholder')} {...register('name')} />
        </Field>

        {noBusinessCustomers ? (
          <p role="status" className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300 sm:col-span-2">
            {t('form.noBusinessCustomers')}
          </p>
        ) : null}
        {selectedNotBusiness && !errors.customerId ? (
          <p
            role="alert"
            className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive sm:col-span-2"
          >
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t('form.notBusiness')}
          </p>
        ) : null}

        <Field label={t('form.startDate')} error={errors.startDate?.message} required>
          <Input type="date" {...register('startDate')} />
        </Field>
        <Field
          label={`${t('form.endDate')} (${t('common:common.optional')})`}
          error={errors.endDate?.message}
          hint={t('form.endDateHint')}
        >
          <Input type="date" {...register('endDate')} />
        </Field>
        <Field
          label={`${t('form.terms')} (${t('common:common.optional')})`}
          error={errors.terms?.message}
          className="sm:col-span-2"
        >
          <Textarea rows={5} maxLength={10000} placeholder={t('form.termsPlaceholder')} {...register('terms')} />
        </Field>
        <div className="sm:col-span-2">
          <Controller
            control={control}
            name="active"
            render={({ field }) => (
              <Checkbox
                label={t('form.active')}
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
              />
            )}
          />
          <p className="mt-1 text-2xs text-muted-foreground">{t('form.activeHint')}</p>
        </div>
      </form>
    </Dialog>
  );
}
