import { useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ImageUp, Trash2 } from 'lucide-react';
import { isValidBusinessId } from '@emotionfix/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { type AllSettings, type CompanySettings, SectionTitle, useSaveSettings, WithSettings } from './shared';

const MAX_LOGO_BYTES = 200 * 1024;

interface CompanyForm {
  name: string;
  oldName: string;
  businessId: string;
  vatNumber: string;
  address: string;
  postalCode: string;
  city: string;
  country: string;
  phone: string;
  email: string;
  iban: string;
  bic: string;
}

export default function CompanyTab() {
  return <WithSettings>{(s) => <CompanyForms settings={s} />}</WithSettings>;
}

function CompanyForms({ settings }: { settings: AllSettings }) {
  const { t } = useTranslation('settings');
  const company = settings.company ?? {};
  return (
    <div className="space-y-4">
      <SectionTitle title={t('company.title')} description={t('company.description')} />
      <CompanyDetailsCard company={company} />
      <LogoCard company={company} />
    </div>
  );
}

function CompanyDetailsCard({ company }: { company: Partial<CompanySettings> }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();

  const schema = useMemo(
    () =>
      z.object({
        name: z.string().trim().min(1, t('validation.required')).max(120),
        oldName: z.string().trim().max(120),
        businessId: z
          .string()
          .trim()
          .refine((v) => v === '' || isValidBusinessId(v), t('company.businessIdInvalid')),
        vatNumber: z
          .string()
          .trim()
          .refine((v) => v === '' || /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(v.replace(/\s/g, '').toUpperCase()), t('company.vatNumberInvalid')),
        address: z.string().trim().max(200),
        postalCode: z.string().trim().max(20),
        city: z.string().trim().max(80),
        country: z.string().trim().max(80),
        phone: z.string().trim().max(40),
        email: z
          .string()
          .trim()
          .refine((v) => v === '' || z.string().email().safeParse(v).success, t('validation.email')),
        iban: z
          .string()
          .trim()
          .refine((v) => v === '' || /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(v.replace(/\s/g, '').toUpperCase()), t('company.ibanInvalid')),
        bic: z
          .string()
          .trim()
          .refine((v) => v === '' || /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(v.toUpperCase()), t('company.bicInvalid')),
      }),
    [t],
  );

  const defaults: CompanyForm = {
    name: company.name ?? '',
    oldName: company.oldName ?? '',
    businessId: company.businessId ?? '',
    vatNumber: company.vatNumber ?? '',
    address: company.address ?? '',
    postalCode: company.postalCode ?? '',
    city: company.city ?? '',
    country: company.country ?? '',
    phone: company.phone ?? '',
    email: company.email ?? '',
    iban: company.iban ?? '',
    bic: company.bic ?? '',
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<CompanyForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  const onSubmit = (values: CompanyForm) => {
    const cleaned: CompanyForm = {
      name: values.name.trim(),
      oldName: values.oldName.trim(),
      businessId: values.businessId.trim(),
      vatNumber: values.vatNumber.replace(/\s/g, '').toUpperCase(),
      address: values.address.trim(),
      postalCode: values.postalCode.trim(),
      city: values.city.trim(),
      country: values.country.trim(),
      phone: values.phone.trim(),
      email: values.email.trim(),
      iban: values.iban.replace(/\s/g, '').toUpperCase(),
      bic: values.bic.trim().toUpperCase(),
    };
    save.mutate([{ key: 'company', value: { ...company, ...cleaned } }], {
      onSuccess: () => reset(cleaned),
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('company.detailsTitle')}</CardTitle>
        <CardDescription>{t('company.detailsHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('company.name')} error={errors.name?.message} required>
              <Input autoComplete="organization" {...register('name')} />
            </Field>
            <Field label={t('company.oldName')} error={errors.oldName?.message} hint={t('company.oldNameHint')}>
              <Input {...register('oldName')} />
            </Field>
            <Field label={t('company.businessId')} error={errors.businessId?.message} hint={t('company.businessIdHint')}>
              <Input placeholder="1234567-8" {...register('businessId')} />
            </Field>
            <Field label={t('company.vatNumber')} error={errors.vatNumber?.message} hint={t('company.vatNumberHint')}>
              <Input placeholder="FI12345678" {...register('vatNumber')} />
            </Field>
            <Field label={t('company.address')} error={errors.address?.message} className="sm:col-span-2">
              <Input autoComplete="street-address" {...register('address')} />
            </Field>
            <Field label={t('company.postalCode')} error={errors.postalCode?.message}>
              <Input autoComplete="postal-code" {...register('postalCode')} />
            </Field>
            <Field label={t('company.city')} error={errors.city?.message}>
              <Input {...register('city')} />
            </Field>
            <Field label={t('company.country')} error={errors.country?.message}>
              <Input {...register('country')} />
            </Field>
            <Field label={t('company.phone')} error={errors.phone?.message}>
              <Input type="tel" autoComplete="tel" {...register('phone')} />
            </Field>
            <Field label={t('company.email')} error={errors.email?.message}>
              <Input type="email" autoComplete="email" {...register('email')} />
            </Field>
            <div className="hidden sm:block" />
            <Field label={t('company.iban')} error={errors.iban?.message} hint={t('company.ibanHint')}>
              <Input placeholder="FI21 1234 5600 0007 85" {...register('iban')} />
            </Field>
            <Field label={t('company.bic')} error={errors.bic?.message}>
              <Input placeholder="NDEAFIHH" {...register('bic')} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => reset(defaults)} disabled={!isDirty || save.isPending}>
              {t('form.discard')}
            </Button>
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {t('common:action.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function LogoCard({ company }: { company: Partial<CompanySettings> }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const logo = company.logoDataUrl ?? null;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error(t('company.logoNotImage'));
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error(t('company.logoTooLarge', { size: Math.round(file.size / 1024) }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        save.mutate([{ key: 'company', value: { ...company, logoDataUrl: reader.result } }]);
      }
    };
    reader.onerror = () => toast.error(t('company.logoReadFailed'));
    reader.readAsDataURL(file);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('company.logoTitle')}</CardTitle>
        <CardDescription>{t('company.logoHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex h-24 w-48 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/40">
            {logo ? (
              <img src={logo} alt={t('company.logoAlt')} className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="text-xs text-muted-foreground">{t('company.noLogo')}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="sr-only"
              aria-label={t('company.uploadLogo')}
              tabIndex={-1}
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={save.isPending}>
              <ImageUp className="h-4 w-4" /> {logo ? t('company.replaceLogo') : t('company.uploadLogo')}
            </Button>
            {logo ? (
              <Button variant="ghost" onClick={() => setConfirmRemove(true)} disabled={save.isPending}>
                <Trash2 className="h-4 w-4" /> {t('company.removeLogo')}
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
      <ConfirmDialog
        open={confirmRemove}
        onClose={() => setConfirmRemove(false)}
        title={t('company.removeLogo')}
        message={t('company.removeLogoConfirm')}
        confirmLabel={t('company.removeLogo')}
        busy={save.isPending}
        onConfirm={() =>
          save.mutate([{ key: 'company', value: { ...company, logoDataUrl: null } }], {
            onSuccess: () => setConfirmRemove(false),
          })
        }
      />
    </Card>
  );
}
