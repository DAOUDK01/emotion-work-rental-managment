import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { Bike } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/input';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
type LoginForm = z.infer<typeof LoginSchema>;

export default function LoginPage() {
  const { t, i18n } = useTranslation('common');
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({ resolver: zodResolver(LoginSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await login(values.email, values.password);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === 'BAD_CREDENTIALS'
          ? t('login.failed')
          : err instanceof Error
            ? err.message
            : t('common.errorTitle'),
      );
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy to-[#143a6b] p-4">
      <Card className="w-full max-w-sm p-6 shadow-2xl">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-accent/15">
            <Bike className="h-6 w-6 text-accent" />
          </div>
          <h1 className="text-lg font-bold">{t('login.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('login.subtitle')}</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-3" noValidate>
          <Field label={t('login.email')} error={errors.email?.message} required>
            <Input type="email" autoComplete="username" autoFocus {...register('email')} />
          </Field>
          <Field label={t('login.password')} error={errors.password?.message} required>
            <Input type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          {error ? (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs font-medium text-destructive">{error}</p>
          ) : null}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {t('login.submit')}
          </Button>
        </form>
        <button
          className="mt-4 w-full text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => void i18n.changeLanguage(i18n.language === 'fi' ? 'en' : 'fi')}
        >
          {i18n.language === 'fi' ? 'In English' : 'Suomeksi'}
        </button>
      </Card>
    </div>
  );
}
