import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CircleAlert, CircleCheck } from 'lucide-react';
import { isValidBusinessId } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import {
  CUSTOMER_LANGUAGES,
  CUSTOMER_TYPES,
  hasPhoneField,
  type Customer,
  type CustomerLanguage,
  type CustomerSaveResponse,
  type CustomerType,
} from './types';

interface FormValues {
  type: CustomerType;
  name: string;
  businessId: string;
  email: string;
  phone: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  language: CustomerLanguage;
  notes: string;
}

/** Create / edit a customer. Same form for both; `customer === null` means create. */
export default function CustomerFormDialog({
  open,
  onClose,
  customer,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  customer: Customer | null;
  onCreated?: (customer: Customer) => void;
}) {
  const { t } = useTranslation('customers');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'ADMIN';
  // When editing as non-admin the API never sent the phone: an empty field must not clear it.
  const phoneHidden = customer !== null && !hasPhoneField(customer);

  const schema = useMemo(
    () =>
      z.object({
        type: z.enum(CUSTOMER_TYPES),
        name: z.string().trim().min(1, t('form.nameRequired')).max(200, t('form.tooLong')),
        businessId: z.string().trim().max(40, t('form.tooLong')),
        email: z
          .string()
          .trim()
          .max(200, t('form.tooLong'))
          .refine((v) => v === '' || z.string().email().safeParse(v).success, t('form.badEmail')),
        phone: z.string().trim().max(40, t('form.tooLong')),
        address: z.string().trim().max(300, t('form.tooLong')),
        postalCode: z.string().trim().max(20, t('form.tooLong')),
        city: z.string().trim().max(100, t('form.tooLong')),
        country: z
          .string()
          .trim()
          .refine((v) => v === '' || /^[A-Za-z]{2}$/.test(v), t('form.badCountry')),
        language: z.enum(CUSTOMER_LANGUAGES),
        notes: z.string().trim().max(2000, t('form.tooLong')),
      }),
    [t],
  );

  const defaults = useMemo<FormValues>(
    () => ({
      type: customer?.type ?? 'INDIVIDUAL',
      name: customer?.name ?? '',
      businessId: customer?.businessId ?? '',
      email: customer?.email ?? '',
      phone: customer?.phone ?? '',
      address: customer?.address ?? '',
      postalCode: customer?.postalCode ?? '',
      city: customer?.city ?? '',
      country: customer?.country ?? 'FI',
      language: customer?.language ?? 'FI',
      notes: customer?.notes ?? '',
    }),
    [customer],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset(defaults);
  }, [open, defaults, reset]);

  const type = watch('type');
  const businessId = watch('businessId').trim();
  const businessIdState: 'none' | 'valid' | 'invalid' =
    type !== 'BUSINESS' || businessId === '' ? 'none' : isValidBusinessId(businessId) ? 'valid' : 'invalid';

  const mutation = useMutation({
    mutationFn: (values: FormValues) => {
      const text = (v: string): string | null => (v.trim() === '' ? null : v.trim());
      const phone = values.phone.trim();
      const body = {
        type: values.type,
        name: values.name.trim(),
        businessId: text(values.businessId),
        email: text(values.email),
        // undefined is dropped from the JSON body → the stored number is left untouched
        phone: phoneHidden && phone === '' ? undefined : text(values.phone),
        address: text(values.address),
        postalCode: text(values.postalCode),
        city: text(values.city),
        country: values.country.trim() === '' ? undefined : values.country.trim().toUpperCase(),
        language: values.language,
        notes: text(values.notes),
      };
      return customer
        ? api.put<CustomerSaveResponse>(`/customers/${customer.id}`, body)
        : api.post<CustomerSaveResponse>('/customers', body);
    },
    onSuccess: (res) => {
      toast.success(t('common:common.savedOk'));
      if (res.businessIdValid === false) toast.warning(t('form.businessIdSavedInvalid'));
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['lookups'] });
      if (!customer) onCreated?.(res.customer);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Dialog open={open} onClose={onClose} title={customer ? t('form.editTitle') : t('form.createTitle')} wide>
      <form onSubmit={handleSubmit((values) => mutation.mutate(values))} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('form.type')} error={errors.type?.message} required>
            <Select {...register('type')}>
              {CUSTOMER_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {t(`type.${ct}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('form.name')} error={errors.name?.message} required>
            <Input autoFocus autoComplete="off" {...register('name')} />
          </Field>
          <Field label={t('form.businessId')} error={errors.businessId?.message}>
            <Input placeholder="1234567-8" autoComplete="off" {...register('businessId')} />
            {businessIdState === 'valid' ? (
              <p className="flex items-center gap-1 text-2xs font-medium text-profit" aria-live="polite">
                <CircleCheck className="h-3 w-3" /> {t('form.businessIdValid')}
              </p>
            ) : businessIdState === 'invalid' ? (
              <p
                className="flex items-center gap-1 text-2xs font-medium text-amber-700 dark:text-amber-400"
                aria-live="polite"
              >
                <CircleAlert className="h-3 w-3" /> {t('form.businessIdInvalid')}
              </p>
            ) : (
              <p className="text-2xs text-muted-foreground">{t('form.businessIdHint')}</p>
            )}
          </Field>
          <Field label={t('form.email')} error={errors.email?.message}>
            <Input type="email" autoComplete="off" {...register('email')} />
          </Field>
          <Field
            label={`${t('form.phone')} ${t('form.adminsOnly')}`}
            error={errors.phone?.message}
            hint={phoneHidden ? t('form.phoneHiddenHint') : isAdmin ? t('form.phoneHint') : t('form.phoneStaffHint')}
          >
            <Input
              type="tel"
              autoComplete="off"
              placeholder={phoneHidden ? t('form.phoneHiddenPlaceholder') : undefined}
              {...register('phone')}
            />
          </Field>
          <Field label={t('form.language')} error={errors.language?.message} hint={t('form.languageHint')}>
            <Select {...register('language')}>
              {CUSTOMER_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {t(`language.${l}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('form.address')} error={errors.address?.message} className="sm:col-span-2">
            <Input autoComplete="off" {...register('address')} />
          </Field>
          <Field label={t('form.postalCode')} error={errors.postalCode?.message}>
            <Input inputMode="numeric" autoComplete="off" {...register('postalCode')} />
          </Field>
          <Field label={t('form.city')} error={errors.city?.message}>
            <Input autoComplete="off" {...register('city')} />
          </Field>
          <Field label={t('form.country')} error={errors.country?.message} hint={t('form.countryHint')}>
            <Input maxLength={2} className="uppercase" autoComplete="off" {...register('country')} />
          </Field>
        </div>
        <Field label={t('common:common.notes')} error={errors.notes?.message}>
          <Textarea rows={3} {...register('notes')} />
        </Field>

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
