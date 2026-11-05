import { useId, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/components/ui/utils';
import {
  INVESTMENT_CATEGORIES,
  ISO_DATE_RE,
  errorMessage,
  parseCents,
  type HolderLookup,
  type InvestmentCategory,
} from './types';

type Owner = 'partner' | 'joint';

interface FormValues {
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

/** Manual investment row (e.g. cash injected) — POST /investments. */
export function InvestmentFormDialog({ partners, onClose }: { partners: HolderLookup[]; onClose: () => void }) {
  const { t } = useTranslation('expenses');
  const formId = useId();
  const queryClient = useQueryClient();

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
    watch,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: todayInHelsinki(),
      owner: partners.length > 0 ? 'partner' : 'joint',
      holderId: partners.length === 1 ? String(partners[0].id) : '',
      category: 'CASH_INJECTED',
      amount: '',
      note: '',
    },
  });
  const owner = watch('owner');
  const ownerOptions: Array<{ value: Owner; label: string }> = [
    ...(partners.length > 0 ? [{ value: 'partner' as const, label: t('investments.partner') }] : []),
    { value: 'joint', label: t('investments.jointLabel') },
  ];

  const save = useMutation({
    mutationFn: (payload: CreateInvestmentPayload) => api.post<{ investment: { id: number } }>('/investments', payload),
    onSuccess: () => {
      toast.success(t('common:common.savedOk'));
      for (const key of ['investments', 'partners', 'dashboard']) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
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
    <Dialog
      open
      onClose={() => (save.isPending ? undefined : onClose())}
      title={t('investments.addTitle')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" form={formId} disabled={save.isPending} className="min-w-28">
            {save.isPending ? t('form.saving') : t('common:action.save')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void onSubmit(e)} className="space-y-3" noValidate>
        <p className="text-xs text-muted-foreground">{t('investments.addHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common:common.date')} error={errors.date?.message} required>
            <Input type="date" aria-label={t('common:common.date')} {...register('date')} />
          </Field>
          <Field label={t('investments.owner')} required>
            {/* native radios so Enter in any field still submits the form */}
            <div role="radiogroup" aria-label={t('investments.owner')} className="inline-flex gap-1 rounded-lg border bg-card p-1">
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
            <Field label={t('investments.partner')} error={errors.holderId?.message} required>
              <Select aria-label={t('investments.partner')} {...register('holderId')}>
                <option value="">{t('investments.selectPartner')}</option>
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="self-end rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
              {partners.length > 0 ? t('investments.jointHint') : t('investments.noPartners')}
            </div>
          )}
          <Field label={t('investments.category')} error={errors.category?.message} required>
            <Select aria-label={t('investments.category')} {...register('category')}>
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
          <Field label={t('investments.note')} error={errors.note?.message} className="sm:col-span-2">
            <Textarea rows={2} aria-label={t('investments.note')} placeholder={t('investments.notePlaceholder')} {...register('note')} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
