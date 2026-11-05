import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CircleCheck, Info, Send, TriangleAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import {
  errorMessage,
  EXAMPLE_MESSAGES,
  FINANCIAL_QUERY_KEYS,
  normalizePhone,
  PHONE_RE,
  statusVariant,
  type SimulateBody,
  type SimulateResponse,
} from './types';

interface SimulateForm {
  from: string;
  text: string;
}

const FORM_ID = 'whatsapp-simulate-form';
const LAST_FROM_KEY = 'emf.whatsapp.simulateFrom';

function readLastFrom(): string {
  try {
    return window.localStorage.getItem(LAST_FROM_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberFrom(value: string): void {
  try {
    window.localStorage.setItem(LAST_FROM_KEY, value);
  } catch {
    // storage unavailable (private mode) — prefill is a convenience only
  }
}

/**
 * "Simulate message": runs POST /whatsapp/simulate { from, text } through the exact webhook
 * pipeline and shows the bot reply here — the way to test without Meta configured.
 */
export function SimulateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('whatsapp');
  const queryClient = useQueryClient();
  const [result, setResult] = useState<SimulateResponse | null>(null);

  const schema = useMemo(
    () =>
      z.object({
        from: z.string().refine((v) => PHONE_RE.test(normalizePhone(v)), t('validation.phone')),
        text: z
          .string()
          .refine((v) => v.trim() !== '', t('validation.textRequired'))
          .refine((v) => v.length <= 4096, t('validation.textTooLong')),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setFocus,
    formState: { errors },
  } = useForm<SimulateForm>({ resolver: zodResolver(schema), defaultValues: { from: '', text: '' } });

  useEffect(() => {
    if (open) {
      reset({ from: readLastFrom(), text: '' });
      setResult(null);
    }
  }, [open, reset]);

  const mutation = useMutation({
    mutationFn: (body: SimulateBody) => api.post<SimulateResponse>('/whatsapp/simulate', body),
    onSuccess: (res, body) => {
      setResult(res);
      rememberFrom(body.from);
      for (const key of FINANCIAL_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: key });
      if (res.status === 'SAVED') {
        toast.success(t('simulate.savedToast'));
        setValue('text', '');
      }
    },
    onError: (err) => {
      setResult(null);
      toast.error(errorMessage(err, t('common:common.errorTitle')));
    },
  });

  const onSubmit = handleSubmit((values) => {
    mutation.mutate({ from: normalizePhone(values.from), text: values.text.replace(/\r/g, '') });
  });

  const close = () => {
    if (!mutation.isPending) onClose();
  };

  const tone: 'success' | 'error' | 'info' | null = result
    ? result.status === 'SAVED'
      ? 'success'
      : result.status === 'ERROR' || result.status === 'REJECTED'
        ? 'error'
        : 'info'
    : null;
  const ToneIcon = tone === 'success' ? CircleCheck : tone === 'error' ? TriangleAlert : Info;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('simulate.title')}
      wide
      footer={
        <>
          <Button variant="outline" onClick={close} disabled={mutation.isPending}>
            {t('common:action.close')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={mutation.isPending}>
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            {mutation.isPending ? t('simulate.sending') : t('simulate.send')}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
        <p className="text-xs text-muted-foreground">{t('simulate.intro')}</p>
        <Field label={t('simulate.from')} error={errors.from?.message} hint={t('simulate.fromHint')} required>
          <Input
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+358401234567"
            className="font-mono sm:max-w-xs"
            {...register('from')}
          />
        </Field>
        <Field label={t('simulate.text')} error={errors.text?.message} hint={t('simulate.textHint')} required>
          <Textarea
            rows={4}
            maxLength={4096}
            spellCheck={false}
            className="font-mono text-xs"
            placeholder={t('simulate.placeholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void onSubmit();
              }
            }}
            {...register('text')}
          />
        </Field>
        <div className="space-y-1.5">
          <p className="text-2xs font-medium text-muted-foreground">{t('simulate.examples')}</p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_MESSAGES.map((ex) => (
              <button
                key={ex}
                type="button"
                className="rounded-full border bg-card px-2 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                title={t('simulate.useExample')}
                onClick={() => {
                  setValue('text', ex, { shouldValidate: true });
                  setFocus('text');
                }}
              >
                {ex.split(' | ')[0]}
              </button>
            ))}
          </div>
        </div>
      </form>

      {result && tone ? (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            'mt-4 space-y-2 rounded-md border px-3 py-2.5',
            tone === 'success' && 'border-profit/40 bg-profit/10',
            tone === 'error' && 'border-loss/40 bg-loss/10',
            tone === 'info' && 'border-sky-500/40 bg-sky-500/10',
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <ToneIcon
              className={cn(
                'h-4 w-4 shrink-0',
                tone === 'success' && 'text-profit',
                tone === 'error' && 'text-loss',
                tone === 'info' && 'text-sky-700 dark:text-sky-400',
              )}
              aria-hidden="true"
            />
            <span className="text-xs font-semibold">{t('simulate.replyTitle')}</span>
            <Badge variant={statusVariant(result.status)}>{t(`status.${result.status}`)}</Badge>
            {result.entryId !== undefined ? (
              <span className="text-2xs text-muted-foreground">{t('summary.entry', { id: result.entryId })}</span>
            ) : null}
            {result.expenseId !== undefined ? (
              <span className="text-2xs text-muted-foreground">{t('summary.expense', { id: result.expenseId })}</span>
            ) : null}
          </div>
          {result.reply ? (
            <pre className="whitespace-pre-wrap break-words rounded bg-card/70 px-2 py-1.5 font-mono text-xs">{result.reply}</pre>
          ) : (
            <p className="text-xs text-muted-foreground">{t('simulate.noReply')}</p>
          )}
          {result.status === 'REJECTED' ? (
            <p className="text-2xs">
              {t('simulate.notAllowed')}{' '}
              <Link to="/settings" className="font-medium text-primary underline-offset-2 hover:underline" onClick={onClose}>
                {t('setup.settingsLink')}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}
