import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { todayInHelsinki } from '@emotionfix/shared';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import {
  currentRateId,
  fmtRateBp,
  pctInputToBp,
  SectionTitle,
  type TaxRateRow,
  type VatRateRow,
  useVocab,
  useVocabSave,
} from './shared';
import SalariesCard from './SalariesCard';

export default function RatesTab() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <SectionTitle title={t('rates.title')} description={t('rates.description')} />
      <VatRatesCard />
      <TaxRatesCard />
      <SalariesCard />
    </div>
  );
}

/* ---------------------------- VAT rates ---------------------------- */

function VatRatesCard() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const q = useVocab<VatRateRow>('vat-rates', 'rates');
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<VatRateRow | null>(null);
  const [inUse, setInUse] = useState(false);
  const today = todayInHelsinki();
  const currentId = useMemo(() => currentRateId((q.data ?? []).filter((r) => r.isDefault), today), [q.data, today]);

  const del = useMutation({
    mutationFn: (id: number) => api.del<{ ok: true }>(`/vocab/vat-rates/${id}`),
    onSuccess: () => {
      toast.success(t('rates.deletedOk'));
      void queryClient.invalidateQueries({ queryKey: ['vocab', 'vat-rates'] });
      void queryClient.invalidateQueries({ queryKey: ['lookups'] });
      setDeleting(null);
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'RATE_IN_USE') {
        setInUse(true);
        toast.error(t('rates.rateInUse'));
      } else {
        toast.error(err.message);
      }
    },
  });

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{t('rates.vatTitle')}</CardTitle>
          <CardDescription>{t('rates.vatHint')}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> {t('rates.addVat')}
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title={t('rates.noVat')} hint={t('rates.noVatHint')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('rates.rate')}</TH>
                <TH>{t('rates.validFrom')}</TH>
                <TH>{t('rates.label')}</TH>
                <TH>{t('rates.type')}</TH>
                <TH className="text-right">{t('common:common.actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium tabular-nums">{fmtRateBp(r.rateBp)}</TD>
                  <TD>{fmtDate(r.validFrom)}</TD>
                  <TD className="text-muted-foreground">{r.label ?? '–'}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={r.isDefault ? 'navy' : 'outline'}>
                        {r.isDefault ? t('rates.default') : t('rates.special')}
                      </Badge>
                      {r.id === currentId ? <Badge variant="success">{t('rates.current')}</Badge> : null}
                      {r.validFrom > today ? <Badge variant="info">{t('rates.upcoming')}</Badge> : null}
                    </div>
                  </TD>
                  <TD className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('rates.deleteRate', { rate: fmtRateBp(r.rateBp) })}
                      title={t('common:action.delete')}
                      onClick={() => {
                        setInUse(false);
                        setDeleting(r);
                      }}
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
      <RateDialog kind="vat" open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t('rates.deleteTitle')}
        message={t('rates.deleteConfirm', {
          rate: deleting ? fmtRateBp(deleting.rateBp) : '',
          date: deleting ? fmtDate(deleting.validFrom) : '',
        })}
        confirmLabel={t('common:action.delete')}
        busy={del.isPending}
        onConfirm={() => deleting && del.mutate(deleting.id)}
      >
        {inUse ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
          >
            {t('rates.rateInUseLong')}
          </div>
        ) : null}
      </ConfirmDialog>
    </Card>
  );
}

/* ---------------------------- Tax rates ---------------------------- */

function TaxRatesCard() {
  const { t } = useTranslation('settings');
  const q = useVocab<TaxRateRow>('tax-rates', 'rates');
  const [adding, setAdding] = useState(false);
  const today = todayInHelsinki();
  const currentId = useMemo(() => currentRateId(q.data ?? [], today), [q.data, today]);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{t('rates.taxTitle')}</CardTitle>
          <CardDescription>{t('rates.taxHint')}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> {t('rates.addTax')}
        </Button>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState title={t('rates.noTax')} hint={t('rates.noTaxHint')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('rates.rate')}</TH>
                <TH>{t('rates.validFrom')}</TH>
                <TH>{t('common:common.status')}</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.map((r) => (
                <TR key={r.id}>
                  <TD className="font-medium tabular-nums">{fmtRateBp(r.rateBp)}</TD>
                  <TD>{fmtDate(r.validFrom)}</TD>
                  <TD>
                    {r.id === currentId ? (
                      <Badge variant="success">{t('rates.current')}</Badge>
                    ) : r.validFrom > today ? (
                      <Badge variant="info">{t('rates.upcoming')}</Badge>
                    ) : (
                      <Badge>{t('rates.history')}</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
      <RateDialog kind="tax" open={adding} onClose={() => setAdding(false)} />
    </Card>
  );
}

/* ------------------------- Add rate dialog ------------------------- */

interface RateForm {
  pct: string;
  validFrom: string;
  label: string;
  isDefault: boolean;
}

function RateDialog({ kind, open, onClose }: { kind: 'vat' | 'tax'; open: boolean; onClose: () => void }) {
  const { t } = useTranslation('settings');
  const save = useVocabSave(kind === 'vat' ? 'vat-rates' : 'tax-rates');

  const schema = useMemo(
    () =>
      z.object({
        pct: z.string().trim().refine((v) => pctInputToBp(v) !== null, t('rates.badPct')),
        validFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.date')),
        label: z.string().trim().max(80),
        isDefault: z.boolean(),
      }),
    [t],
  );
  const defaults: RateForm = { pct: '', validFrom: todayInHelsinki(), label: '', isDefault: true };
  const {
    register,
    handleSubmit,
    reset,
    watch,
    control,
    formState: { errors },
  } = useForm<RateForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (open) reset({ pct: '', validFrom: todayInHelsinki(), label: '', isDefault: true });
  }, [open, reset]);

  const bp = pctInputToBp(watch('pct'));

  const onSubmit = (values: RateForm) => {
    const rateBp = pctInputToBp(values.pct);
    if (rateBp === null) return;
    const body =
      kind === 'vat'
        ? { rateBp, validFrom: values.validFrom, label: values.label.trim() || null, isDefault: values.isDefault }
        : { rateBp, validFrom: values.validFrom };
    save.mutate({ body }, { onSuccess: onClose });
  };

  return (
    <Dialog open={open} onClose={onClose} title={kind === 'vat' ? t('rates.addVat') : t('rates.addTax')}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('rates.ratePct')}
            error={errors.pct?.message}
            hint={bp !== null ? t('rates.bpPreview', { bp }) : t('rates.ratePctHint')}
            required
          >
            <Input autoFocus inputMode="decimal" placeholder={kind === 'vat' ? '25,5' : '20'} {...register('pct')} />
          </Field>
          <Field label={t('rates.validFrom')} error={errors.validFrom?.message} required>
            <Input type="date" {...register('validFrom')} />
          </Field>
        </div>
        {kind === 'vat' ? (
          <>
            <Field label={t('rates.label')} error={errors.label?.message} hint={t('rates.labelHint')}>
              <Input {...register('label')} />
            </Field>
            <Controller
              control={control}
              name="isDefault"
              render={({ field }) => (
                <Checkbox
                  label={t('rates.isDefault')}
                  checked={field.value}
                  onChange={(e) => field.onChange(e.target.checked)}
                  onBlur={field.onBlur}
                />
              )}
            />
            <p className="text-2xs text-muted-foreground">{t('rates.isDefaultHint')}</p>
          </>
        ) : (
          <p className="text-2xs text-muted-foreground">{t('rates.taxDialogHint')}</p>
        )}
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
