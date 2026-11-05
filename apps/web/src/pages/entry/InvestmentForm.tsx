import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CheckCircle2, X } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import { INVESTMENT_CATEGORIES, parseCents, type InvestmentCategory, type Lookups } from './types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Owner = 'partner' | 'joint';

interface InvestmentValues {
  date: string;
  owner: Owner;
  holderId: string;
  category: InvestmentCategory;
  amount: string;
  note: string;
}

interface CreateInvestmentPayload {
  date: string;
  holderId: number | null;
  isJoint: boolean;
  category: InvestmentCategory;
  amountCents: number;
  note: string | null;
}

interface SavedInvestment {
  date: string;
  who: string;
  category: InvestmentCategory;
  amountCents: number;
}

function emptyInvestment(date: string, owner: Owner, holderId: string): InvestmentValues {
  return { date, owner, holderId, category: 'CASH_INJECTED', amount: '', note: '' };
}

/** INVESTMENT tab (ADMIN) — manual partner / joint investment rows: POST /investments. */
export function InvestmentForm({ lookups }: { lookups: Lookups }) {
  const { t } = useTranslation('entry');
  const queryClient = useQueryClient();
  const partners = lookups.holders.filter((h) => h.kind === 'PARTNER');
  const [saved, setSaved] = useState<SavedInvestment | null>(null);

  const schema = useMemo(
    () =>
      z
        .object({
          date: z.string().regex(ISO_DATE_RE, t('validation.dateRequired')),
          owner: z.enum(['partner', 'joint']),
          holderId: z.string(),
          category: z.enum(INVESTMENT_CATEGORIES),
          amount: z.string(),
          note: z.string().max(500, t('validation.tooLong')),
        })
        .superRefine((v, ctx) => {
          const amount = parseCents(v.amount);
          if (amount === null || amount === 0) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount'], message: t('validation.amountInvalid') });
          }
          if (v.owner === 'partner' && !v.holderId) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['holderId'], message: t('validation.partnerRequired') });
          }
        }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { errors },
  } = useForm<InvestmentValues>({
    resolver: zodResolver(schema),
    defaultValues: emptyInvestment(todayInHelsinki(), partners.length > 0 ? 'partner' : 'joint', ''),
  });
  const owner = watch('owner');
  const ownerOptions: Array<{ value: Owner; label: string }> = [
    ...(partners.length > 0 ? [{ value: 'partner' as const, label: t('investment.partner') }] : []),
    { value: 'joint', label: t('investment.joint') },
  ];

  const save = useMutation({
    mutationFn: (payload: CreateInvestmentPayload) => api.post<{ investment: { id: number } }>('/investments', payload),
    onSuccess: (_res, payload) => {
      toast.success(t('common:common.savedOk'));
      const holder = partners.find((p) => p.id === payload.holderId);
      setSaved({
        date: payload.date,
        who: payload.isJoint ? t('investment.joint') : (holder?.name ?? ''),
        category: payload.category,
        amountCents: payload.amountCents,
      });
      void queryClient.invalidateQueries({ queryKey: ['investments'] });
      void queryClient.invalidateQueries({ queryKey: ['partners'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      reset(emptyInvestment(payload.date, payload.isJoint ? 'joint' : 'partner', payload.holderId ? String(payload.holderId) : ''));
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('common:common.errorTitle')),
  });

  const onSubmit = handleSubmit((v) => {
    const amountCents = parseCents(v.amount);
    if (amountCents === null) return;
    const isJoint = v.owner === 'joint';
    save.mutate({
      date: v.date,
      holderId: isJoint ? null : Number(v.holderId),
      isJoint,
      category: v.category,
      amountCents,
      note: v.note.trim() || null,
    });
  });

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        {saved ? (
          <div className="flex items-start gap-3 rounded-lg border border-profit/40 bg-profit/10 p-3 text-sm" role="status">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-profit" aria-hidden />
            <p className="flex-1 font-semibold text-profit">
              {t('investment.success', {
                amount: fmtEUR(saved.amountCents),
                who: saved.who,
                category: t(`investmentCategory.${saved.category}`),
                date: fmtDate(saved.date),
              })}
            </p>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSaved(null)} aria-label={t('common:action.close')}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : null}

        <Card>
          <CardContent className="pt-4">
            <form onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('common:common.date')} error={errors.date?.message} required>
                  <Input type="date" aria-label={t('common:common.date')} {...register('date')} />
                </Field>
                <Field label={t('investment.owner')} required>
                  {/* native radios (not buttons) so Enter in any field still submits the form */}
                  <div role="radiogroup" aria-label={t('investment.owner')} className="inline-flex gap-1 rounded-lg border bg-card p-1">
                    {ownerOptions.map((o) => (
                      <label
                        key={o.value}
                        className={cn(
                          'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-within:ring-2 focus-within:ring-ring',
                          owner === o.value
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        <input type="radio" value={o.value} className="sr-only" {...register('owner')} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                </Field>

                {owner === 'partner' ? (
                  <Field label={t('investment.partner')} error={errors.holderId?.message} required>
                    <Select aria-label={t('investment.partner')} {...register('holderId')}>
                      <option value="">{t('investment.selectPartner')}</option>
                      {partners.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <div className="self-end rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    {partners.length > 0 ? t('investment.jointHint') : t('investment.noPartners')}
                  </div>
                )}
                <Field label={t('fields.category')} error={errors.category?.message} required>
                  <Select aria-label={t('fields.category')} {...register('category')}>
                    {INVESTMENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {t(`investmentCategory.${c}`)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label={t('common:common.amount')} error={errors.amount?.message} required>
                  <Input inputMode="decimal" placeholder="0,00" aria-label={t('common:common.amount')} {...register('amount')} />
                </Field>
                <Field label={t('investment.note')} error={errors.note?.message} className="sm:col-span-2">
                  <Textarea rows={2} aria-label={t('investment.note')} placeholder={t('investment.notePlaceholder')} {...register('note')} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  onClick={() => reset(emptyInvestment(getValues('date'), getValues('owner'), getValues('holderId')))}
                  disabled={save.isPending}
                >
                  {t('actions.clear')}
                </Button>
                <Button type="submit" size="lg" disabled={save.isPending} className="min-w-40">
                  {save.isPending ? t('actions.saving') : t('investment.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{t('investment.infoTitle')}</CardTitle>
          <CardDescription>{t('investment.infoText')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {INVESTMENT_CATEGORIES.map((c) => (
              <li key={c}>
                <span className="font-medium text-foreground">{t(`investmentCategory.${c}`)}</span> — {t(`investmentCategoryHint.${c}`)}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
