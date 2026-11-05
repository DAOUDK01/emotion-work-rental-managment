import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { euroInputToCents } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/misc';
import { CustomerPicker, type PickedCustomer } from './CustomerPicker';
import { InvoiceActions } from './InvoiceActions';
import { InvoiceSummaryCard } from './InvoiceHeader';
import { LinesEditor } from './LinesEditor';
import {
  defaultVatRateOn,
  dueDateFrom,
  parseQty,
  vatRateOptions,
  type EditorLine,
  type InvoiceDetail,
  type InvoiceLanguage,
  type InvoiceLinePayload,
  type InvoicePayload,
  type InvoiceResponse,
  type Lookups,
  type UnitRef,
} from './types';

export interface DraftHeaderForm {
  language: InvoiceLanguage;
  modelId: string;
  unitId: string;
  issueDate: string;
  termsDays: string;
  dueDate: string;
  deliveryDate: string;
  periodText: string;
  notes: string;
}

export interface DraftInitial {
  header: DraftHeaderForm;
  customer: PickedCustomer | null;
  lines: EditorLine[];
  /** Unit to keep selectable even before /units loads (edit / rental prefill). */
  presetUnit: UnitRef | null;
  rentalId: number | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const snapshot = (customer: PickedCustomer | null, lines: EditorLine[]) =>
  JSON.stringify({ c: customer?.id ?? null, l: lines.map(({ key: _key, ...rest }) => rest) });

/** Create / edit a DRAFT invoice (header fields + lines). Existing drafts also get Send/PDF actions. */
export function DraftEditor({
  invoice,
  initial,
  lookups,
  warnings,
}: {
  invoice: InvoiceDetail | null;
  initial: DraftInitial;
  lookups: Lookups;
  warnings: string[];
}) {
  const { t, i18n } = useTranslation('invoices');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [customer, setCustomer] = useState<PickedCustomer | null>(initial.customer);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [lines, setLines] = useState<EditorLine[]>(initial.lines);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [linesError, setLinesError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(() => snapshot(initial.customer, initial.lines));
  const [dialogOpen, setDialogOpen] = useState(false);
  const submittedRef = useRef<{ header: DraftHeaderForm; snapshot: string } | null>(null);

  const schema = useMemo(
    () =>
      z
        .object({
          language: z.enum(['EN', 'FI']),
          modelId: z.string(),
          unitId: z.string(),
          issueDate: z.string().regex(ISO, t('validation.date')),
          termsDays: z.string().refine((v) => /^\d{1,3}$/.test(v.trim()) && Number(v) <= 365, t('validation.terms')),
          dueDate: z.string().regex(ISO, t('validation.date')),
          deliveryDate: z.union([z.literal(''), z.string().regex(ISO, t('validation.date'))]),
          periodText: z.string().max(120, t('validation.tooLong', { max: 120 })),
          notes: z.string().max(2000, t('validation.tooLong', { max: 2000 })),
        })
        .refine((v) => !ISO.test(v.issueDate) || !ISO.test(v.dueDate) || v.dueDate >= v.issueDate, {
          path: ['dueDate'],
          message: t('validation.dueBeforeIssue'),
        }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    getValues,
    watch,
    formState: { errors, isDirty },
  } = useForm<DraftHeaderForm>({ resolver: zodResolver(schema), defaultValues: initial.header });

  const units = useQuery({
    queryKey: ['units', 'list-light'],
    queryFn: () => api.get<{ units: Array<{ id: number; code: string }> }>('/units' + qs({ pageSize: 200 })),
    staleTime: 60_000,
  });
  const unitOptions = useMemo(() => {
    const list = units.data?.units ?? [];
    const preset = initial.presetUnit;
    return preset && !list.some((u) => u.id === preset.id) ? [{ id: preset.id, code: preset.code }, ...list] : list;
  }, [units.data, initial.presetUnit]);

  const issueDate = watch('issueDate');
  const language = watch('language');
  const defaultVatBp = defaultVatRateOn(lookups, ISO.test(issueDate) ? issueDate : initial.header.issueDate);
  const vatOptions = useMemo(
    () => vatRateOptions(lookups, lines.map((l) => l.vatRateBp)),
    [lookups, lines],
  );

  const dirty = isDirty || snapshot(customer, lines) !== baseline;

  // warn before leaving the page with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** Terms or issue date changed → recompute the due date (the user may still override it). */
  const recomputeDue = () => {
    const { issueDate: issue, termsDays } = getValues();
    if (ISO.test(issue) && /^\d{1,3}$/.test(termsDays.trim()) && Number(termsDays) <= 365) {
      setValue('dueDate', dueDateFrom(issue, Number(termsDays)), { shouldDirty: true, shouldValidate: true });
    }
  };

  const save = useMutation({
    mutationFn: (payload: InvoicePayload) =>
      invoice
        ? api.put<InvoiceResponse>(`/invoices/${invoice.id}`, payload)
        : api.post<InvoiceResponse>('/invoices', payload),
    onSuccess: (res) => {
      queryClient.setQueryData(['invoices', res.invoice.id], res);
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(t('common:common.savedOk'));
      if (!invoice) {
        navigate(`/invoices/${res.invoice.id}`, { replace: true });
        return;
      }
      // what was submitted is now the saved state; edits typed meanwhile stay in the form
      const submitted = submittedRef.current;
      if (submitted) {
        reset(submitted.header, { keepValues: true });
        setBaseline(submitted.snapshot);
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t('common:common.errorTitle')),
  });

  /** Customer + lines live outside react-hook-form; validate them on every submit attempt. */
  const validateExtras = (): InvoiceLinePayload[] | null => {
    let ok = true;
    if (!customer) {
      setCustomerError(t('validation.customerRequired'));
      ok = false;
    } else setCustomerError(null);

    const errs: Record<string, string> = {};
    const payload: InvoiceLinePayload[] = [];
    for (const line of lines) {
      const qty = parseQty(line.qty);
      const price = euroInputToCents(line.unitPrice);
      const discount = line.discount.trim() === '' ? 0 : euroInputToCents(line.discount);
      let message: string | null = null;
      if (!line.description.trim()) message = t('validation.lineDescription');
      else if (qty === null) message = t('validation.lineQty');
      else if (price === null || price < 0) message = t('validation.linePrice');
      else if (discount === null || discount < 0 || discount > Math.round(qty * price)) message = t('validation.lineDiscount');
      if (message || qty === null || price === null || discount === null) {
        errs[line.key] = message ?? t('validation.linePrice');
        continue;
      }
      payload.push({
        ...(line.productId ? { productId: line.productId } : {}),
        description: line.description.trim(),
        qty,
        unitPriceCents: price,
        discountCents: discount,
        vatRateBp: line.vatRateBp,
        isLabour: line.isLabour,
      });
    }
    setLineErrors(errs);
    if (lines.length === 0) {
      setLinesError(t('validation.linesRequired'));
      ok = false;
    } else if (Object.keys(errs).length > 0) {
      setLinesError(t('validation.linesInvalid'));
      ok = false;
    } else setLinesError(null);
    return ok ? payload : null;
  };

  const onSubmit = handleSubmit(
    (values) => {
      const linePayload = validateExtras();
      if (!linePayload || !customer) return;
      submittedRef.current = { header: values, snapshot: snapshot(customer, lines) };
      save.mutate({
        customerId: customer.id,
        modelId: values.modelId ? Number(values.modelId) : null,
        unitId: values.unitId ? Number(values.unitId) : null,
        ...(!invoice && initial.rentalId ? { rentalId: initial.rentalId } : {}),
        language: values.language,
        issueDate: values.issueDate,
        deliveryDate: values.deliveryDate || null,
        periodText: values.periodText.trim() || null,
        termsDays: Number(values.termsDays),
        dueDate: values.dueDate,
        notes: values.notes.trim() || null,
        lines: linePayload,
      });
    },
    () => {
      validateExtras();
      toast.error(t('validation.fixErrors'));
    },
  );

  const modelName = (m: Lookups['models'][number]) => (i18n.language === 'fi' ? m.nameFi : m.nameEn);

  return (
    <div className="mx-auto max-w-6xl space-y-4 pb-20">
      <PageHeader
        title={invoice ? t('editor.editTitle', { number: invoice.numberFormatted }) : t('editor.newTitle')}
        description={t('editor.subtitle')}
        actions={
          <>
            <Link to="/invoices" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              <ArrowLeft className="h-4 w-4" /> {t('actions.backToList')}
            </Link>
            <Button onClick={() => void onSubmit()} disabled={save.isPending}>
              <Save className="h-4 w-4" /> {invoice ? t('editor.save') : t('editor.create')}
            </Button>
          </>
        }
      />

      {warnings.map((w) => (
        <div
          key={w}
          role="alert"
          className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300"
        >
          {w}
        </div>
      ))}

      {invoice ? (
        <InvoiceSummaryCard
          invoice={invoice}
          actions={
            <InvoiceActions
              invoice={invoice}
              canWrite
              sendBlockedReason={dirty ? t('editor.saveBeforeSend') : null}
              onDialogChange={setDialogOpen}
            />
          }
        />
      ) : null}

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>{t('editor.details')}</CardTitle>
            <CardDescription>{t('editor.detailsHint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label={t('editor.customer')} error={customerError ?? undefined} required className="sm:col-span-2">
              <CustomerPicker
                id="invoice-customer"
                value={customer}
                invalid={Boolean(customerError)}
                onChange={(c) => {
                  setCustomer(c);
                  if (c) setCustomerError(null);
                  if (c?.language) setValue('language', c.language, { shouldDirty: true });
                }}
              />
            </Field>
            <Field label={t('fields.language')} hint={t('editor.languageHint')}>
              <Select {...register('language')}>
                <option value="EN">{t('language.EN')}</option>
                <option value="FI">{t('language.FI')}</option>
              </Select>
            </Field>
            <Field label={t('editor.model')} hint={t('editor.modelHint')}>
              <Select {...register('modelId')}>
                <option value="">{t('editor.modelDefault')}</option>
                {lookups.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {modelName(m)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('editor.unit')}>
              <Select {...register('unitId')}>
                <option value="">{t('common:common.none')}</option>
                {unitOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('fields.issueDate')} error={errors.issueDate?.message} required>
              <Input type="date" {...register('issueDate', { onChange: recomputeDue })} />
            </Field>
            <Field label={t('editor.termsDays')} error={errors.termsDays?.message} required>
              <Input inputMode="numeric" {...register('termsDays', { onChange: recomputeDue })} />
            </Field>
            <Field label={t('fields.dueDate')} error={errors.dueDate?.message} hint={t('editor.dueHint')} required>
              <Input type="date" {...register('dueDate')} />
            </Field>
            <Field label={t('editor.deliveryDate')} error={errors.deliveryDate?.message}>
              <Input type="date" {...register('deliveryDate')} />
            </Field>
            <Field
              label={t('editor.periodText')}
              error={errors.periodText?.message}
              hint={t('editor.periodHint')}
              className="sm:col-span-2"
            >
              <Input maxLength={120} placeholder={t('editor.periodPlaceholder')} {...register('periodText')} />
            </Field>
            <Field label={t('common:common.notes')} error={errors.notes?.message} hint={t('editor.notesHint')} className="sm:col-span-2 lg:col-span-3">
              <Textarea maxLength={2000} {...register('notes')} />
            </Field>
          </CardContent>
        </Card>
      </form>

      <Card>
        <CardHeader>
          <CardTitle>{t('lines.title')}</CardTitle>
          <CardDescription>{t('lines.hint', { language: t(`language.${language}`) })}</CardDescription>
        </CardHeader>
        <CardContent>
          <LinesEditor
            lines={lines}
            setLines={setLines}
            language={language}
            vatOptions={vatOptions}
            defaultVatBp={defaultVatBp}
            lineErrors={lineErrors}
            error={linesError}
            scanEnabled={!dialogOpen && !save.isPending}
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-2 z-20 flex flex-wrap items-center justify-end gap-3 rounded-lg border bg-background/95 px-4 py-3 shadow-sm backdrop-blur">
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {dirty ? t('editor.unsaved') : invoice ? t('editor.allSaved') : ''}
        </span>
        <Button onClick={() => void onSubmit()} disabled={save.isPending}>
          <Save className="h-4 w-4" /> {invoice ? t('editor.save') : t('editor.create')}
        </Button>
      </div>
    </div>
  );
}
