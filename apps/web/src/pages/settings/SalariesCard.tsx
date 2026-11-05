import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api } from '@/lib/api';
import { euroInputToCents, fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { type SalaryRow, type VocabHolder, useVocab, useVocabSave } from './shared';

/** Partner salaries — effective-dated monthly amounts that the P&L shows as an expense. */
export default function SalariesCard() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const q = useVocab<SalaryRow>('salaries', 'salaries');
  const holders = useVocab<VocabHolder>('holders', 'holders');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<SalaryRow | null>(null);
  const today = todayInHelsinki();

  // the salary in effect today per partner
  const currentIds = useMemo(() => {
    const best = new Map<number, SalaryRow>();
    for (const s of q.data ?? []) {
      if (s.validFrom > today) continue;
      const prev = best.get(s.holderId);
      if (!prev || s.validFrom > prev.validFrom) best.set(s.holderId, s);
    }
    return new Set([...best.values()].map((s) => s.id));
  }, [q.data, today]);

  const partners = (holders.data ?? []).filter((h) => h.kind === 'PARTNER' && h.active);

  const del = useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/vocab/salaries/${id}`),
    onSuccess: () => {
      toast.success(t('salaries.deletedOk'));
      void queryClient.invalidateQueries({ queryKey: ['vocab', 'salaries'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setDeleting(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{t('salaries.title')}</CardTitle>
          <CardDescription>{t('salaries.hint')}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} disabled={!partners.length}>
          <Plus className="h-3.5 w-3.5" /> {t('salaries.add')}
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState
            title={t('salaries.empty')}
            hint={partners.length ? t('salaries.emptyHint') : t('salaries.noPartners')}
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('salaries.partner')}</TH>
                <TH className="text-right">{t('salaries.monthly')}</TH>
                <TH>{t('rates.validFrom')}</TH>
                <TH>{t('common:common.notes')}</TH>
                <TH className="text-right">{t('common:common.actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((s) => (
                <TR key={s.id}>
                  <TD className="font-medium">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.holder.name}
                      {currentIds.has(s.id) ? <Badge variant="success">{t('rates.current')}</Badge> : null}
                      {s.validFrom > today ? <Badge variant="info">{t('rates.upcoming')}</Badge> : null}
                    </div>
                  </TD>
                  <TDMoney>{fmtEUR(s.monthlyCents)}</TDMoney>
                  <TD>{fmtDate(s.validFrom)}</TD>
                  <TD className="max-w-[16rem] truncate text-muted-foreground" title={s.note ?? undefined}>
                    {s.note ?? '–'}
                  </TD>
                  <TD className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('salaries.deleteAria', { name: s.holder.name, date: fmtDate(s.validFrom) })}
                      title={t('common:action.delete')}
                      onClick={() => setDeleting(s)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      <SalaryDialog open={adding} onClose={() => setAdding(false)} partners={partners} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('salaries.deleteTitle')}
        message={t('salaries.deleteConfirm', {
          name: deleting?.holder.name ?? '',
          amount: deleting ? fmtEUR(deleting.monthlyCents) : '',
          date: deleting ? fmtDate(deleting.validFrom) : '',
        })}
        confirmLabel={t('common:action.delete')}
        busy={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      />
    </Card>
  );
}

interface SalaryForm {
  holderId: string;
  monthly: string;
  validFrom: string;
  note: string;
}

function SalaryDialog({ open, onClose, partners }: { open: boolean; onClose: () => void; partners: VocabHolder[] }) {
  const { t } = useTranslation('settings');
  const save = useVocabSave('salaries');

  const schema = useMemo(
    () =>
      z.object({
        holderId: z.string().min(1, t('validation.required')),
        monthly: z
          .string()
          .trim()
          .refine((v) => {
            const c = euroInputToCents(v);
            return c !== null && c >= 0;
          }, t('validation.amount')),
        validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.date')),
        note: z.string().trim().max(200),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<SalaryForm>({
    resolver: zodResolver(schema),
    defaultValues: { holderId: '', monthly: '', validFrom: todayInHelsinki(), note: '' },
  });

  // preselect when there is exactly one partner (stable primitive dep, not the array)
  const singlePartnerId = partners.length === 1 ? partners[0].id : null;
  useEffect(() => {
    if (open) {
      reset({
        holderId: singlePartnerId !== null ? String(singlePartnerId) : '',
        monthly: '',
        validFrom: todayInHelsinki(),
        note: '',
      });
    }
  }, [open, singlePartnerId, reset]);

  const onSubmit = (values: SalaryForm) => {
    const monthlyCents = euroInputToCents(values.monthly);
    if (monthlyCents === null) return;
    save.mutate(
      {
        body: {
          holderId: Number(values.holderId),
          monthlyCents,
          validFrom: values.validFrom,
          note: values.note.trim() || null,
        },
      },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('salaries.add')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('salaries.partner')} error={errors.holderId?.message} required>
            <Select autoFocus {...register('holderId')}>
              <option value="">{t('form.choose')}</option>
              {partners.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('salaries.monthly')} error={errors.monthly?.message} hint={t('salaries.monthlyHint')} required>
            <Input inputMode="decimal" placeholder="1500,00" {...register('monthly')} />
          </Field>
          <Field label={t('rates.validFrom')} error={errors.validFrom?.message} hint={t('salaries.validFromHint')} required>
            <Input type="date" {...register('validFrom')} />
          </Field>
          <Field label={t('common:common.notes')} error={errors.note?.message}>
            <Input {...register('note')} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('common:action.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
