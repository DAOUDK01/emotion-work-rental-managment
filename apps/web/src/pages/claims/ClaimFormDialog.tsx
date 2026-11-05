import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api, qs } from '@/lib/api';
import { centsToInput, euroInputToCents } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { CustomerSearch, type PickedCustomer } from './CustomerSearch';
import {
  errorMessage,
  type Claim,
  type ClaimResponse,
  type ClaimWriteBody,
  type ProductOption,
  type UnitOption,
} from './types';

interface ClaimForm {
  company: string;
  customer: PickedCustomer | null;
  unitId: string;
  productId: string;
  description: string;
  claimed: string;
  submittedAt: string;
  notes: string;
}

const FORM_ID = 'claim-form';

/** Create a new warranty claim or edit an existing one (status changes have their own dialog). */
export function ClaimFormDialog({
  open,
  claim,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = create */
  claim: Claim | null;
  onClose: () => void;
  onSaved?: (claim: Claim) => void;
}) {
  const { t, i18n } = useTranslation('claims');
  const queryClient = useQueryClient();
  const editing = claim !== null;

  const units = useQuery({
    queryKey: ['units', 'list', 'claim-options'],
    queryFn: () => api.get<{ units: UnitOption[] }>('/units' + qs({ pageSize: 200 })),
    enabled: open,
    staleTime: 60_000,
  });
  const products = useQuery({
    queryKey: ['products', 'list', 'claim-options'],
    queryFn: () => api.get<{ products: ProductOption[] }>('/products' + qs({ pageSize: 200, active: 'true' })),
    enabled: open,
    staleTime: 60_000,
  });

  const schema = useMemo(
    () =>
      z.object({
        company: z.string().trim().min(1, t('validation.companyRequired')).max(200, t('validation.tooLong')),
        customer: z.custom<PickedCustomer | null>(),
        unitId: z.string(),
        productId: z.string(),
        description: z
          .string()
          .trim()
          .min(1, t('validation.descriptionRequired'))
          .max(2000, t('validation.tooLong')),
        claimed: z.string().refine((v) => {
          if (v.trim() === '') return true;
          const cents = euroInputToCents(v);
          return cents !== null && cents >= 0;
        }, t('validation.amountInvalid')),
        submittedAt: z.string().refine((v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v), t('validation.dateInvalid')),
        notes: z.string().max(2000, t('validation.tooLong')),
      }),
    [t],
  );

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ClaimForm>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      company: claim?.company ?? '',
      customer: claim?.customer ? { id: claim.customer.id, name: claim.customer.name, type: claim.customer.type } : null,
      unitId: claim?.unitId ? String(claim.unitId) : '',
      productId: claim?.productId ? String(claim.productId) : '',
      description: claim?.description ?? '',
      claimed: centsToInput(claim?.claimedCents),
      submittedAt: claim?.submittedAt ?? '',
      notes: claim?.notes ?? '',
    });
  }, [open, claim, reset]);

  // Keep the claim's current unit/product selectable even when it is no longer in the active lists.
  const unitOptions = useMemo(() => {
    const list = units.data?.units ?? [];
    if (claim?.unit && !list.some((u) => u.id === claim.unit!.id)) {
      return [{ id: claim.unit.id, code: claim.unit.code, brand: claim.unit.brand, modelName: claim.unit.modelName }, ...list];
    }
    return list;
  }, [units.data, claim]);
  const productOptions = useMemo(() => {
    const list = products.data?.products ?? [];
    if (claim?.product && !list.some((p) => p.id === claim.product!.id)) {
      return [{ id: claim.product.id, sku: claim.product.sku, nameEn: claim.product.nameEn, nameFi: claim.product.nameFi }, ...list];
    }
    return list;
  }, [products.data, claim]);

  const productName = (p: ProductOption) => (i18n.language === 'fi' && p.nameFi ? p.nameFi : p.nameEn);

  const mutation = useMutation({
    mutationFn: (body: ClaimWriteBody) =>
      claim ? api.put<ClaimResponse>(`/claims/${claim.id}`, body) : api.post<ClaimResponse>('/claims', body),
    onSuccess: (res) => {
      toast.success(editing ? t('common:common.savedOk') : t('form.created', { caseNumber: res.claim.caseNumber }));
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
      onSaved?.(res.claim);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const onSubmit = handleSubmit((v) => {
    const notes = v.notes.trim();
    mutation.mutate({
      company: v.company.trim(),
      description: v.description.trim(),
      customerId: v.customer?.id ?? null,
      unitId: v.unitId ? Number(v.unitId) : null,
      productId: v.productId ? Number(v.productId) : null,
      claimedCents: v.claimed.trim() === '' ? null : euroInputToCents(v.claimed),
      submittedAt: v.submittedAt || null,
      notes: notes === '' ? null : notes,
    });
  });

  const close = () => {
    if (!mutation.isPending) onClose();
  };
  const optional = (label: string) => `${label} (${t('common:common.optional')})`;

  return (
    <Dialog
      open={open}
      onClose={close}
      wide
      title={claim ? t('form.editTitle', { caseNumber: claim.caseNumber }) : t('form.createTitle')}
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
        <Field label={t('form.company')} error={errors.company?.message} required>
          <Input autoFocus maxLength={200} placeholder={t('form.companyPlaceholder')} {...register('company')} />
        </Field>
        <Field label={optional(t('form.customer'))}>
          <Controller
            control={control}
            name="customer"
            render={({ field }) => <CustomerSearch value={field.value ?? null} onChange={field.onChange} />}
          />
        </Field>
        <Field
          label={optional(t('form.unit'))}
          hint={units.isError ? t('form.optionsFailed') : undefined}
        >
          <Select {...register('unitId')} disabled={units.isLoading}>
            <option value="">{units.isLoading ? t('form.loadingOptions') : t('form.noUnit')}</option>
            {unitOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.brand}
                {u.modelName ? ` ${u.modelName}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={optional(t('form.product'))}
          hint={products.isError ? t('form.optionsFailed') : undefined}
        >
          <Select {...register('productId')} disabled={products.isLoading}>
            <option value="">{products.isLoading ? t('form.loadingOptions') : t('form.noProduct')}</option>
            {productOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.sku} — {productName(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('form.description')} error={errors.description?.message} required className="sm:col-span-2">
          <Textarea rows={3} maxLength={2000} placeholder={t('form.descriptionPlaceholder')} {...register('description')} />
        </Field>
        <Field label={optional(t('form.claimed'))} error={errors.claimed?.message}>
          <Input inputMode="decimal" autoComplete="off" placeholder="0,00" {...register('claimed')} />
        </Field>
        <Field label={optional(t('form.submittedAt'))} error={errors.submittedAt?.message} hint={t('form.submittedHint')}>
          <Input type="date" {...register('submittedAt')} />
        </Field>
        <Field label={optional(t('common:common.notes'))} error={errors.notes?.message} className="sm:col-span-2">
          <Textarea rows={2} maxLength={2000} {...register('notes')} />
        </Field>
      </form>
    </Dialog>
  );
}
