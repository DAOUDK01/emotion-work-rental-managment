import { useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/input';
import { type AllSettings, SectionTitle, type SmtpSettings, useSaveSettings, WithSettings } from './shared';

interface SmtpForm {
  host: string;
  port: string;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export default function EmailTab() {
  return <WithSettings>{(s) => <SmtpCard settings={s} />}</WithSettings>;
}

function SmtpCard({ settings }: { settings: AllSettings }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();
  const [showPass, setShowPass] = useState(false);
  const smtp = settings.smtp ?? {};

  const schema = useMemo(
    () =>
      z.object({
        host: z.string().trim().max(200),
        port: z
          .string()
          .trim()
          .refine((v) => v === '' || (/^\d{1,5}$/.test(v) && Number(v) >= 1 && Number(v) <= 65535), t('email.portInvalid')),
        secure: z.boolean(),
        user: z.string().trim().max(200),
        pass: z.string().max(500),
        from: z.string().trim().max(200),
      }),
    [t],
  );

  const defaults: SmtpForm = {
    host: smtp.host ?? '',
    port: smtp.port !== undefined ? String(smtp.port) : '',
    secure: smtp.secure ?? false,
    user: smtp.user ?? '',
    pass: smtp.pass ?? '',
    from: smtp.from ?? '',
  };

  const {
    register,
    handleSubmit,
    reset,
    control,
    setValue,
    getValues,
    formState: { errors, isDirty },
  } = useForm<SmtpForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  const onSubmit = (v: SmtpForm) => {
    // empty fields are omitted so the server falls back to its SMTP_* environment variables
    const value: SmtpSettings = {};
    if (v.host.trim()) value.host = v.host.trim();
    if (v.port.trim()) value.port = Number(v.port);
    value.secure = v.secure;
    if (v.user.trim()) value.user = v.user.trim();
    if (v.pass) value.pass = v.pass;
    if (v.from.trim()) value.from = v.from.trim();
    save.mutate([{ key: 'smtp', value }], { onSuccess: () => reset(v) });
  };

  return (
    <div className="space-y-4">
      <SectionTitle title={t('email.title')} description={t('email.description')} />
      <Card>
        <CardHeader>
          <CardTitle>{t('email.smtpTitle')}</CardTitle>
          <CardDescription>{t('email.smtpHint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate autoComplete="off">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t('email.host')} error={errors.host?.message} hint={t('email.hostHint')}>
                <Input placeholder="smtp.example.com" {...register('host')} />
              </Field>
              <Field label={t('email.port')} error={errors.port?.message} hint={t('email.portHint')}>
                <Input inputMode="numeric" placeholder="587" {...register('port')} />
              </Field>
              <Field label={t('email.user')} error={errors.user?.message}>
                <Input autoComplete="off" {...register('user')} />
              </Field>
              <Field label={t('email.pass')} error={errors.pass?.message} hint={t('email.passHint')}>
                <div className="flex gap-2">
                  <Input type={showPass ? 'text' : 'password'} autoComplete="new-password" {...register('pass')} />
                  <Button
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    aria-label={showPass ? t('form.hidePassword') : t('form.showPassword')}
                    aria-pressed={showPass}
                    onClick={() => setShowPass((s) => !s)}
                  >
                    {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
              </Field>
              <Field label={t('email.from')} error={errors.from?.message} hint={t('email.fromHint')} className="sm:col-span-2">
                <Input placeholder="E Motion Works Oy <info@example.fi>" {...register('from')} />
              </Field>
            </div>
            <Controller
              control={control}
              name="secure"
              render={({ field }) => (
                <div className="space-y-1">
                  <Checkbox
                    label={t('email.secure')}
                    checked={field.value}
                    onChange={(e) => {
                      field.onChange(e.target.checked);
                      // convenience: suggest the matching standard port when it is still a default
                      const port = getValues('port').trim();
                      if (port === '' || port === '587' || port === '465') {
                        setValue('port', e.target.checked ? '465' : '587', { shouldDirty: true });
                      }
                    }}
                  />
                  <p className="pl-6 text-2xs text-muted-foreground">{t('email.secureHint')}</p>
                </div>
              )}
            />
            <p className="text-2xs text-muted-foreground">{t('email.envFallback')}</p>
            <div className="flex justify-end gap-2">
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
    </div>
  );
}
