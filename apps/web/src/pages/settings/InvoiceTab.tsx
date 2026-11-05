import { useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/input';
import { type AllSettings, SectionTitle, useSaveSettings, WithSettings } from './shared';

interface InvoiceForm {
  termsDaysDefault: string;
  reminderDays: string;
  lateInterestTextEn: string;
  lateInterestTextFi: string;
  footerEn: string;
  footerFi: string;
}

export default function InvoiceTab() {
  return <WithSettings>{(s) => <InvoiceForms settings={s} />}</WithSettings>;
}

function InvoiceForms({ settings }: { settings: AllSettings }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();
  const invoice = settings.invoice ?? {};
  const prefix = invoice.numberingPrefix ?? 'year';
  const year = new Date().getFullYear();

  const schema = useMemo(() => {
    const days = (min: number) =>
      z
        .string()
        .trim()
        .refine((v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= 365, t('validation.daysRange', { min }));
    return z.object({
      termsDaysDefault: days(0),
      reminderDays: days(1),
      lateInterestTextEn: z.string().trim().max(500),
      lateInterestTextFi: z.string().trim().max(500),
      footerEn: z.string().trim().max(500),
      footerFi: z.string().trim().max(500),
    });
  }, [t]);

  const defaults: InvoiceForm = {
    termsDaysDefault: String(invoice.termsDaysDefault ?? 14),
    reminderDays: String(invoice.reminderDays ?? 7),
    lateInterestTextEn: invoice.lateInterestTextEn ?? '',
    lateInterestTextFi: invoice.lateInterestTextFi ?? '',
    footerEn: invoice.footerEn ?? '',
    footerFi: invoice.footerFi ?? '',
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<InvoiceForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  const onSubmit = (values: InvoiceForm) => {
    const value = {
      ...invoice,
      numberingPrefix: prefix,
      termsDaysDefault: Number(values.termsDaysDefault),
      reminderDays: Number(values.reminderDays),
      lateInterestTextEn: values.lateInterestTextEn.trim(),
      lateInterestTextFi: values.lateInterestTextFi.trim(),
      footerEn: values.footerEn.trim(),
      footerFi: values.footerFi.trim(),
    };
    save.mutate([{ key: 'invoice', value }], { onSuccess: () => reset(values) });
  };

  return (
    <div className="space-y-4">
      <SectionTitle title={t('invoice.title')} description={t('invoice.description')} />
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Card>
          <CardHeader>
            <CardTitle>{t('invoice.numberingTitle')}</CardTitle>
            <CardDescription>{t('invoice.numberingHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label={t('invoice.numberingPrefix')}
                hint={prefix === 'year' ? t('invoice.yearHint', { example: `${year}-0001` }) : undefined}
              >
                <Input value={prefix} readOnly aria-readonly="true" className="bg-muted/40" />
              </Field>
              <Field label={t('invoice.termsDays')} error={errors.termsDaysDefault?.message} hint={t('invoice.termsDaysHint')} required>
                <Input inputMode="numeric" {...register('termsDaysDefault')} />
              </Field>
              <Field label={t('invoice.reminderDays')} error={errors.reminderDays?.message} hint={t('invoice.reminderDaysHint')} required>
                <Input inputMode="numeric" {...register('reminderDays')} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('invoice.textsTitle')}</CardTitle>
            <CardDescription>{t('invoice.textsHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('invoice.lateInterestEn')} error={errors.lateInterestTextEn?.message}>
                <Textarea rows={3} {...register('lateInterestTextEn')} />
              </Field>
              <Field label={t('invoice.lateInterestFi')} error={errors.lateInterestTextFi?.message}>
                <Textarea rows={3} lang="fi" {...register('lateInterestTextFi')} />
              </Field>
              <Field label={t('invoice.footerEn')} error={errors.footerEn?.message}>
                <Textarea rows={3} {...register('footerEn')} />
              </Field>
              <Field label={t('invoice.footerFi')} error={errors.footerFi?.message}>
                <Textarea rows={3} lang="fi" {...register('footerFi')} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => reset(defaults)} disabled={!isDirty || save.isPending}>
            {t('form.discard')}
          </Button>
          <Button type="submit" disabled={!isDirty || save.isPending}>
            {t('common:action.save')}
          </Button>
        </div>
      </form>
    </div>
  );
}
