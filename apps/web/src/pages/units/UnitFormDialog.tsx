import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { centsToInput, euroInputToCents } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/input';
import {
  UNIT_CATEGORIES,
  UNIT_STATUSES,
  previewCode,
  type Unit,
  type UnitCategory,
  type UnitStatus,
  type UnitsLookups,
} from './types';

interface FormValues {
  brand: string;
  modelName: string;
  category: UnitCategory;
  inclusions: string;
  purchaseDate: string;
  sellerName: string;
  purchase: string;
  ownerId: string;
  paidById: string;
  status: UnitStatus;
  notes: string;
  codeOverride: string;
}

/** Create / edit a unit. The code preview mirrors the API's prefix + YYMMDD generation. */
export default function UnitFormDialog({
  open,
  onClose,
  unit,
  lookups,
}: {
  open: boolean;
  onClose: () => void;
  unit: Unit | null; // null = create
  lookups: UnitsLookups | undefined;
}) {
  const { t } = useTranslation('units');
  const queryClient = useQueryClient();
  const [showAdvanced, setShowAdvanced] = useState(false);

  const schema = useMemo(
    () =>
      z.object({
        brand: z.string().trim().min(1, t('form.brandRequired')).max(80),
        modelName: z.string().trim().max(80),
        category: z.enum(UNIT_CATEGORIES),
        inclusions: z.string().trim().max(300),
        purchaseDate: z.string(),
        sellerName: z.string().trim().max(120),
        purchase: z
          .string()
          .trim()
          .refine((v) => v === '' || euroInputToCents(v) !== null, t('form.badAmount')),
        ownerId: z.string(),
        paidById: z.string(),
        status: z.enum(UNIT_STATUSES),
        notes: z.string().trim().max(2000),
        codeOverride: z
          .string()
          .trim()
          .refine(
            (v) => v === '' || /^[A-Za-z0-9][A-Za-z0-9._-]{1,39}$/.test(v),
            t('form.badCode'),
          ),
      }),
    [t],
  );

  const defaults = useMemo<FormValues>(
    () => ({
      brand: unit?.brand ?? '',
      modelName: unit?.modelName ?? '',
      category: unit?.category ?? 'E_SCOOTER',
      inclusions: unit?.inclusions ?? '',
      purchaseDate: unit?.purchaseDate ?? '',
      sellerName: unit?.sellerName ?? '',
      purchase: centsToInput(unit?.purchaseCents),
      ownerId: unit?.ownerId != null ? String(unit.ownerId) : '',
      paidById: unit?.paidById != null ? String(unit.paidById) : '',
      status: unit?.status ?? 'AVAILABLE',
      notes: unit?.notes ?? '',
      codeOverride: '',
    }),
    [unit],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) {
      reset(defaults);
      setShowAdvanced(false);
    }
  }, [open, defaults, reset]);

  const brand = watch('brand');
  const purchaseDate = watch('purchaseDate');
  const codeOverride = watch('codeOverride');
  const codePreview =
    codeOverride.trim() !== ''
      ? codeOverride.trim()
      : unit && !/-DRAFT\d*$/.test(unit.code)
        ? unit.code
        : previewCode(brand, purchaseDate, lookups?.unitPrefixes ?? []);

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const body = {
        brand: values.brand.trim(),
        modelName: values.modelName.trim() || null,
        category: values.category,
        inclusions: values.inclusions.trim() || null,
        purchaseDate: values.purchaseDate || null,
        sellerName: values.sellerName.trim() || null,
        purchaseCents: values.purchase.trim() === '' ? null : euroInputToCents(values.purchase),
        ownerId: values.ownerId === '' ? null : Number(values.ownerId),
        paidById: values.paidById === '' ? null : Number(values.paidById),
        status: values.status,
        notes: values.notes.trim() || null,
        codeOverride: values.codeOverride.trim() || null,
      };
      return unit
        ? api.put<{ unit: Unit }>(`/units/${unit.id}`, body)
        : api.post<{ unit: Unit }>('/units', body);
    },
    onSuccess: () => {
      toast.success(t('common:common.savedOk'));
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const holders = (lookups?.holders ?? []).filter((h) => h.active);
  // Owners are the partners; keep a legacy non-partner owner selectable when editing.
  const ownerOptions = holders.filter((h) => h.kind === 'PARTNER' || h.id === unit?.ownerId);

  return (
    <Dialog open={open} onClose={onClose} title={unit ? t('form.editTitle') : t('form.createTitle')} wide>
      <form
        onSubmit={handleSubmit((values) => mutation.mutate(values))}
        className="space-y-3"
        noValidate
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('form.brand')} error={errors.brand?.message} required>
            <Input autoFocus placeholder={t('form.brandPlaceholder')} {...register('brand')} />
          </Field>
          <Field label={t('form.modelName')} error={errors.modelName?.message}>
            <Input {...register('modelName')} />
          </Field>
          <Field label={t('table.category')} error={errors.category?.message} required>
            <Select {...register('category')}>
              {UNIT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('form.inclusions')} error={errors.inclusions?.message} hint={t('form.inclusionsHint')}>
            <Input {...register('inclusions')} />
          </Field>
          <Field
            label={t('form.purchaseDate')}
            error={errors.purchaseDate?.message}
            hint={t('form.codePreview', { code: codePreview })}
          >
            <Input type="date" {...register('purchaseDate')} />
          </Field>
          <Field label={t('form.seller')} error={errors.sellerName?.message}>
            <Input {...register('sellerName')} />
          </Field>
          <Field label={t('form.purchasePrice')} error={errors.purchase?.message}>
            <Input inputMode="decimal" placeholder="450,00" {...register('purchase')} />
          </Field>
          <Field label={t('form.owner')} error={errors.ownerId?.message} hint={t('form.ownerHint')}>
            <Select {...register('ownerId')}>
              <option value="">{t('common:common.none')}</option>
              {ownerOptions.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:money.paidBy')} error={errors.paidById?.message} hint={t('form.paidByHint')}>
            <Select {...register('paidById')}>
              <option value="">{t('common:common.none')}</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('common:common.status')} error={errors.status?.message}>
            <Select {...register('status')}>
              {UNIT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t('common:common.notes')} error={errors.notes?.message}>
          <Textarea rows={2} {...register('notes')} />
        </Field>

        <Checkbox
          label={t('form.advancedToggle')}
          checked={showAdvanced}
          onChange={(e) => setShowAdvanced(e.target.checked)}
        />
        {showAdvanced ? (
          <Field
            label={t('form.codeOverride')}
            error={errors.codeOverride?.message}
            hint={t('form.codeOverrideHint')}
          >
            <Input placeholder="EE2-251001" {...register('codeOverride')} />
          </Field>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {t('common:action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
