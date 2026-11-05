import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import {
  type AllSettings,
  HOLDER_KINDS,
  type HolderKind,
  type VocabCategory,
  type VocabHolder,
  type VocabMethod,
  type VocabModel,
  type VocabPrefix,
  useVocabSave,
} from './shared';

interface DialogProps<T> {
  open: boolean;
  row: T | null; // null = create
  onClose: () => void;
}

function useSortOrderSchema() {
  const { t } = useTranslation('settings');
  return useMemo(
    () => z.string().trim().refine((v) => /^-?\d{1,6}$/.test(v), t('validation.integer')),
    [t],
  );
}

function DialogButtons({ busy, onClose, isNew }: { busy: boolean; onClose: () => void; isNew: boolean }) {
  const { t } = useTranslation('settings');
  return (
    <div className="flex justify-end gap-2 pt-1">
      <Button variant="outline" onClick={onClose} disabled={busy}>
        {t('common:action.cancel')}
      </Button>
      <Button type="submit" disabled={busy}>
        {isNew ? t('common:action.add') : t('common:action.save')}
      </Button>
    </div>
  );
}

function ActiveCheckbox({
  checked,
  onChange,
  isSystem,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  isSystem?: boolean;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-1">
      <Checkbox label={t('lists.activeLabel')} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <p className="text-2xs text-muted-foreground">{isSystem ? t('lists.systemHint') : t('lists.activeHint')}</p>
    </div>
  );
}

/* ------------------------------ models ------------------------------ */

interface ModelForm {
  code: string;
  nameEn: string;
  nameFi: string;
  color: string;
  sortOrder: string;
  active: boolean;
}

export function ModelDialog({ open, row, onClose }: DialogProps<VocabModel>) {
  const { t } = useTranslation('settings');
  const save = useVocabSave('models');
  const sortOrder = useSortOrderSchema();
  const isNew = row === null;

  const schema = useMemo(
    () =>
      z.object({
        code: z
          .string()
          .trim()
          .refine((v) => !isNew || /^[A-Z0-9_]{2,40}$/.test(v), t('lists.codeInvalid')),
        nameEn: z.string().trim().min(1, t('validation.required')).max(80),
        nameFi: z.string().trim().min(1, t('validation.required')).max(80),
        color: z
          .string()
          .trim()
          .refine((v) => v === '' || /^#[0-9a-fA-F]{6}$/.test(v), t('lists.colorInvalid')),
        sortOrder,
        active: z.boolean(),
      }),
    [t, isNew, sortOrder],
  );

  const defaults = useMemo<ModelForm>(
    () => ({
      code: row?.code ?? '',
      nameEn: row?.nameEn ?? '',
      nameFi: row?.nameFi ?? '',
      color: row?.color ?? '',
      sortOrder: String(row?.sortOrder ?? 0),
      active: row?.active ?? true,
    }),
    [row],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors },
  } = useForm<ModelForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const color = watch('color');

  const onSubmit = (v: ModelForm) => {
    const body: Record<string, unknown> = {
      nameEn: v.nameEn.trim(),
      nameFi: v.nameFi.trim(),
      color: v.color.trim() || null,
      sortOrder: Number(v.sortOrder),
      active: v.active,
    };
    if (isNew) body.code = v.code.trim();
    save.mutate({ id: row?.id, body }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? t('lists.addModel') : t('lists.editModel')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('lists.code')}
            error={errors.code?.message}
            hint={isNew ? t('lists.codeHint') : t('lists.codeImmutable')}
            required={isNew}
            className="sm:col-span-2"
          >
            <Input
              autoFocus={isNew}
              readOnly={!isNew}
              aria-readonly={!isNew}
              className={isNew ? 'font-mono uppercase' : 'bg-muted/40 font-mono'}
              placeholder="BATTERY_SERVICE"
              {...register('code', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                  if (isNew) setValue('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
                },
              })}
            />
          </Field>
          <Field label={t('lists.nameEn')} error={errors.nameEn?.message} required>
            <Input autoFocus={!isNew} {...register('nameEn')} />
          </Field>
          <Field label={t('lists.nameFi')} error={errors.nameFi?.message} required>
            <Input lang="fi" {...register('nameFi')} />
          </Field>
          <Field label={t('lists.color')} error={errors.color?.message} hint={t('lists.colorHint')}>
            <div className="flex gap-2">
              <input
                type="color"
                aria-label={t('lists.pickColor')}
                className="h-9 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-card p-1"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0b2545'}
                onChange={(e) => setValue('color', e.target.value, { shouldDirty: true, shouldValidate: true })}
              />
              <Input placeholder="#0b2545" className="font-mono" {...register('color')} />
            </div>
          </Field>
          <Field label={t('lists.sortOrder')} error={errors.sortOrder?.message} hint={t('lists.sortOrderHint')}>
            <Input inputMode="numeric" {...register('sortOrder')} />
          </Field>
        </div>
        <Controller
          control={control}
          name="active"
          render={({ field }) => <ActiveCheckbox checked={field.value} onChange={field.onChange} isSystem={row?.isSystem} />}
        />
        <DialogButtons busy={save.isPending} onClose={onClose} isNew={isNew} />
      </form>
    </Dialog>
  );
}

/* ------------------------------ holders ------------------------------ */

interface HolderForm {
  name: string;
  kind: HolderKind;
  sortOrder: string;
  active: boolean;
}

export function HolderDialog({ open, row, onClose }: DialogProps<VocabHolder>) {
  const { t } = useTranslation('settings');
  const save = useVocabSave('holders');
  const queryClient = useQueryClient();
  const sortOrder = useSortOrderSchema();
  const isNew = row === null;

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('validation.required')).max(60),
        kind: z.enum(['PARTNER', 'COMPANY', 'CASHBOX', 'OTHER']),
        sortOrder,
        active: z.boolean(),
      }),
    [t, sortOrder],
  );

  const defaults = useMemo<HolderForm>(
    () => ({
      name: row?.name ?? '',
      kind: row?.kind ?? 'OTHER',
      sortOrder: String(row?.sortOrder ?? 0),
      active: row?.active ?? true,
    }),
    [row],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors },
  } = useForm<HolderForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const kind = watch('kind');
  const name = watch('name');
  const renaming = !isNew && row !== null && name.trim() !== row.name;

  /** VAT defaults are keyed by holder name — carry the flag over to the new name. */
  const migrateVatDefault = async (oldName: string, newName: string) => {
    const { settings } = await api.get<{ settings: AllSettings }>('/settings');
    const vd = settings.vatDefaults;
    const byHolder = vd?.byHolder ?? {};
    if (!(oldName in byHolder)) return;
    const next: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(byHolder)) next[k === oldName ? newName : k] = v;
    await api.put('/settings/vatDefaults', { value: { ...vd, byHolder: next } });
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
  };

  const onSubmit = (v: HolderForm) => {
    const newName = v.name.trim();
    save.mutate(
      { id: row?.id, body: { name: newName, kind: v.kind, sortOrder: Number(v.sortOrder), active: v.active } },
      {
        onSuccess: () => {
          if (row && row.name !== newName) {
            migrateVatDefault(row.name, newName).catch((err: Error) => toast.error(err.message));
          }
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? t('lists.addHolder') : t('lists.editHolder')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('lists.name')}
            error={errors.name?.message}
            hint={renaming ? t('lists.renameHolderHint') : undefined}
            required
          >
            <Input autoFocus {...register('name')} />
          </Field>
          <Field label={t('lists.kind')} error={errors.kind?.message} hint={t(`kindHint.${kind}`)} required>
            <Select {...register('kind')}>
              {HOLDER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('lists.sortOrder')} error={errors.sortOrder?.message} hint={t('lists.sortOrderHint')}>
            <Input inputMode="numeric" {...register('sortOrder')} />
          </Field>
        </div>
        <Controller
          control={control}
          name="active"
          render={({ field }) => <ActiveCheckbox checked={field.value} onChange={field.onChange} isSystem={row?.isSystem} />}
        />
        <DialogButtons busy={save.isPending} onClose={onClose} isNew={isNew} />
      </form>
    </Dialog>
  );
}

/* --------------------------- payment methods --------------------------- */

interface MethodForm {
  name: string;
  nameFi: string;
  defaultVatInvoice: boolean;
  sortOrder: string;
  active: boolean;
}

export function MethodDialog({ open, row, onClose }: DialogProps<VocabMethod>) {
  const { t } = useTranslation('settings');
  const save = useVocabSave('methods');
  const sortOrder = useSortOrderSchema();
  const isNew = row === null;

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('validation.required')).max(60),
        nameFi: z.string().trim().max(60),
        defaultVatInvoice: z.boolean(),
        sortOrder,
        active: z.boolean(),
      }),
    [t, sortOrder],
  );

  const defaults = useMemo<MethodForm>(
    () => ({
      name: row?.name ?? '',
      nameFi: row?.nameFi ?? '',
      defaultVatInvoice: row?.defaultVatInvoice ?? false,
      sortOrder: String(row?.sortOrder ?? 0),
      active: row?.active ?? true,
    }),
    [row],
  );

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<MethodForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const onSubmit = (v: MethodForm) =>
    save.mutate(
      {
        id: row?.id,
        body: {
          name: v.name.trim(),
          nameFi: v.nameFi.trim() || null,
          defaultVatInvoice: v.defaultVatInvoice,
          sortOrder: Number(v.sortOrder),
          active: v.active,
        },
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? t('lists.addMethod') : t('lists.editMethod')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('lists.nameEn')} error={errors.name?.message} required>
            <Input autoFocus {...register('name')} />
          </Field>
          <Field label={t('lists.nameFi')} error={errors.nameFi?.message}>
            <Input lang="fi" {...register('nameFi')} />
          </Field>
          <Field label={t('lists.sortOrder')} error={errors.sortOrder?.message} hint={t('lists.sortOrderHint')}>
            <Input inputMode="numeric" {...register('sortOrder')} />
          </Field>
        </div>
        <Controller
          control={control}
          name="defaultVatInvoice"
          render={({ field }) => (
            <div className="space-y-1 rounded-md border bg-muted/30 p-3">
              <Checkbox
                label={t('lists.defaultVatInvoiceLabel')}
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
              />
              <p className="text-2xs text-muted-foreground">{t('lists.defaultVatInvoiceHint')}</p>
            </div>
          )}
        />
        <Controller
          control={control}
          name="active"
          render={({ field }) => <ActiveCheckbox checked={field.value} onChange={field.onChange} isSystem={row?.isSystem} />}
        />
        <DialogButtons busy={save.isPending} onClose={onClose} isNew={isNew} />
      </form>
    </Dialog>
  );
}

/* -------------------------- expense categories -------------------------- */

interface CategoryForm {
  nameEn: string;
  nameFi: string;
  sortOrder: string;
  active: boolean;
}

export function CategoryDialog({ open, row, onClose }: DialogProps<VocabCategory>) {
  const { t } = useTranslation('settings');
  const save = useVocabSave('expense-categories');
  const sortOrder = useSortOrderSchema();
  const isNew = row === null;

  const schema = useMemo(
    () =>
      z.object({
        nameEn: z.string().trim().min(1, t('validation.required')).max(80),
        nameFi: z.string().trim().max(80),
        sortOrder,
        active: z.boolean(),
      }),
    [t, sortOrder],
  );

  const defaults = useMemo<CategoryForm>(
    () => ({
      nameEn: row?.nameEn ?? '',
      nameFi: row?.nameFi ?? '',
      sortOrder: String(row?.sortOrder ?? 0),
      active: row?.active ?? true,
    }),
    [row],
  );

  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors },
  } = useForm<CategoryForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const onSubmit = (v: CategoryForm) =>
    save.mutate(
      {
        id: row?.id,
        body: {
          nameEn: v.nameEn.trim(),
          nameFi: v.nameFi.trim() || null,
          sortOrder: Number(v.sortOrder),
          active: v.active,
        },
      },
      { onSuccess: onClose },
    );

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? t('lists.addCategory') : t('lists.editCategory')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('lists.nameEn')} error={errors.nameEn?.message} required>
            <Input autoFocus {...register('nameEn')} />
          </Field>
          <Field label={t('lists.nameFi')} error={errors.nameFi?.message}>
            <Input lang="fi" {...register('nameFi')} />
          </Field>
          <Field label={t('lists.sortOrder')} error={errors.sortOrder?.message} hint={t('lists.sortOrderHint')}>
            <Input inputMode="numeric" {...register('sortOrder')} />
          </Field>
        </div>
        <Controller
          control={control}
          name="active"
          render={({ field }) => <ActiveCheckbox checked={field.value} onChange={field.onChange} isSystem={row?.isSystem} />}
        />
        <DialogButtons busy={save.isPending} onClose={onClose} isNew={isNew} />
      </form>
    </Dialog>
  );
}

/* ---------------------------- unit prefixes ---------------------------- */

interface PrefixForm {
  prefix: string;
  brandName: string;
  active: boolean;
}

export function PrefixDialog({ open, row, onClose }: DialogProps<VocabPrefix>) {
  const { t } = useTranslation('settings');
  const save = useVocabSave('unit-prefixes');
  const isNew = row === null;

  const schema = useMemo(
    () =>
      z.object({
        prefix: z
          .string()
          .trim()
          .refine((v) => /^[A-Z0-9]{1,10}$/.test(v), t('lists.prefixInvalid')),
        brandName: z.string().trim().min(1, t('validation.required')).max(80),
        active: z.boolean(),
      }),
    [t],
  );

  const defaults = useMemo<PrefixForm>(
    () => ({ prefix: row?.prefix ?? '', brandName: row?.brandName ?? '', active: row?.active ?? true }),
    [row],
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    control,
    formState: { errors },
  } = useForm<PrefixForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const onSubmit = (v: PrefixForm) =>
    save.mutate(
      { id: row?.id, body: { prefix: v.prefix.trim(), brandName: v.brandName.trim(), active: v.active } },
      { onSuccess: onClose },
    );

  return (
    <Dialog open={open} onClose={onClose} title={isNew ? t('lists.addPrefix') : t('lists.editPrefix')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('lists.prefix')}
            error={errors.prefix?.message}
            hint={isNew ? t('lists.prefixHint') : t('lists.prefixEditHint')}
            required
          >
            <Input
              autoFocus
              className="font-mono uppercase"
              placeholder="EE2"
              {...register('prefix', {
                onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                  setValue('prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')),
              })}
            />
          </Field>
          <Field label={t('lists.brandName')} error={errors.brandName?.message} hint={t('lists.brandNameHint')} required>
            <Input {...register('brandName')} />
          </Field>
        </div>
        <Controller
          control={control}
          name="active"
          render={({ field }) => <ActiveCheckbox checked={field.value} onChange={field.onChange} />}
        />
        <DialogButtons busy={save.isPending} onClose={onClose} isNew={isNew} />
      </form>
    </Dialog>
  );
}
