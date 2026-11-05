import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { Camera, ChevronDown, ChevronRight, PackagePlus, ScanLine, Search, X } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { centsToInput, euroInputToCents, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { ProductFormDialog } from './ProductFormDialog';
import { ProductPicker } from './ProductPicker';
import { useProductCategories } from './ProductsTab';
import { CameraScanDialog, useWedgeScanner } from './scanner';
import { fmtTime, productName, type MovementList, type Product, type Supplier } from './types';

interface FormValues {
  qty: string;
  unitCost: string;
  supplierId: string;
  shipping: string;
  customs: string;
  importVat: string;
  notes: string;
}

const emptyForm: FormValues = { qty: '1', unitCost: '', supplierId: '', shipping: '', customs: '', importVat: '', notes: '' };

const moneyOrNull = (v: string): number | null => (v.trim() === '' ? null : euroInputToCents(v));
const nonNegativeMoney = (v: string) => {
  if (v.trim() === '') return true;
  const c = euroInputToCents(v);
  return c !== null && c >= 0;
};

/** Goods receiving: scan → product → qty / cost / supplier (+ landed import costs) → PURCHASE movement. */
export function ReceivingTab({
  preselected,
  onPreselectedUsed,
}: {
  preselected: Product | null;
  onPreselectedUsed: () => void;
}) {
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const barcodeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement | null>(null);
  const [code, setCode] = useState('');
  const [product, setProduct] = useState<Product | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const today = todayInHelsinki();

  const categories = useProductCategories();
  const suppliers = useQuery({
    queryKey: ['products', 'suppliers'],
    queryFn: () => api.get<{ suppliers: Supplier[] }>('/products/suppliers' + qs({ active: 'true', pageSize: 200 })),
    staleTime: 60_000,
  });
  const todays = useQuery({
    queryKey: ['stock', 'movements', 'receipts', today],
    queryFn: () => api.get<MovementList>('/stock/movements' + qs({ type: 'PURCHASE', from: today, to: today, pageSize: 200 })),
  });

  const schema = useMemo(
    () =>
      z.object({
        qty: z.string().trim().regex(/^[1-9]\d{0,5}$/, t('receiving.badQty')),
        unitCost: z.string().refine(nonNegativeMoney, t('form.badAmount')),
        supplierId: z.string(),
        shipping: z.string().refine(nonNegativeMoney, t('form.badAmount')),
        customs: z.string().refine(nonNegativeMoney, t('form.badAmount')),
        importVat: z.string().refine(nonNegativeMoney, t('form.badAmount')),
        notes: z.string().trim().max(2000),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: emptyForm });

  // the native select can only show the chosen supplier once its <option> exists: re-sync after load
  useEffect(() => {
    if (suppliers.data) setValue('supplierId', getValues('supplierId'));
  }, [suppliers.data, setValue, getValues]);

  const choose = useCallback(
    (p: Product) => {
      setProduct(p);
      setUnknownCode(null);
      setLookupError(null);
      setShowImport(false);
      reset({
        ...emptyForm,
        unitCost: centsToInput(p.costCents),
        supplierId: p.supplierId != null ? String(p.supplierId) : '',
      });
      setTimeout(() => {
        qtyRef.current?.focus();
        qtyRef.current?.select();
      }, 0);
    },
    [reset],
  );

  useEffect(() => {
    if (preselected) {
      choose(preselected);
      onPreselectedUsed();
    }
  }, [preselected, choose, onPreselectedUsed]);

  const lookup = useCallback(
    async (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      setCode(value);
      setLookupBusy(true);
      setLookupError(null);
      setUnknownCode(null);
      try {
        const { product: found } = await api.get<{ product: Product }>(`/products/barcode/${encodeURIComponent(value)}`);
        choose(found);
        setCode('');
      } catch (err) {
        if (err instanceof ApiError && (err.code === 'UNKNOWN_BARCODE' || err.status === 404)) {
          setProduct(null);
          setUnknownCode(value);
        } else {
          setLookupError(err instanceof Error ? err.message : t('common:common.errorTitle'));
        }
      } finally {
        setLookupBusy(false);
      }
    },
    [choose, t],
  );

  useWedgeScanner((scanned) => void lookup(scanned), !cameraOpen && !createOpen);

  const clearProduct = () => {
    setProduct(null);
    reset(emptyForm);
    setTimeout(() => barcodeRef.current?.focus(), 0);
  };

  const receive = useMutation({
    mutationFn: (values: FormValues) => {
      if (!product) throw new Error(t('receiving.chooseFirst'));
      return api.post<{ product: Product }>('/stock/receive', {
        productId: product.id,
        qty: Number(values.qty.trim()),
        unitCostCents: moneyOrNull(values.unitCost),
        supplierId: values.supplierId === '' ? null : Number(values.supplierId),
        shippingCents: moneyOrNull(values.shipping),
        customsCents: moneyOrNull(values.customs),
        importVatCents: moneyOrNull(values.importVat),
        notes: values.notes.trim() || null,
      });
    },
    onSuccess: ({ product: updated }, values) => {
      toast.success(
        t('receiving.receivedOk', { qty: Number(values.qty.trim()), name: productName(updated, i18n.language), stock: updated.stockQty ?? 0 }),
      );
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      clearProduct();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const [qty, unitCost, shipping, customs, importVat] = watch(['qty', 'unitCost', 'shipping', 'customs', 'importVat']);
  const landed = useMemo(() => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 1) return null;
    const unit = moneyOrNull(unitCost);
    const extras = (moneyOrNull(shipping) ?? 0) + (moneyOrNull(customs) ?? 0) + (moneyOrNull(importVat) ?? 0);
    if (unit === null && extras === 0) return null;
    return { perUnit: Math.round((n * (unit ?? 0) + extras) / n), total: n * (unit ?? 0) + extras, extras };
  }, [qty, unitCost, shipping, customs, importVat]);

  const { ref: qtyRegisterRef, ...qtyField } = register('qty');
  const receipts = todays.data?.movements ?? [];
  const receiptsValue = receipts.reduce((sum, m) => sum + m.qty * (m.unitCostCents ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('receiving.scanTitle')}</CardTitle>
          <CardDescription>{t('receiving.scanHint')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void lookup(code);
            }}
          >
            <div className="relative min-w-[14rem] flex-1">
              <ScanLine className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={barcodeRef}
                autoFocus
                className="h-11 pl-8 font-mono text-base"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={t('receiving.barcodePlaceholder')}
                aria-label={t('receiving.barcode')}
                autoComplete="off"
              />
            </div>
            <Button type="submit" className="h-11" disabled={!code.trim() || lookupBusy}>
              <Search className="h-4 w-4" /> {t('receiving.find')}
            </Button>
            <Button variant="outline" className="h-11" onClick={() => setCameraOpen(true)}>
              <Camera className="h-4 w-4" /> {t('scan.camera')}
            </Button>
          </form>

          <div className="space-y-1">
            <p className="text-2xs font-medium text-muted-foreground">{t('receiving.orSearch')}</p>
            <ProductPicker label={t('receiving.product')} value={product} onChange={(p) => (p ? choose(p) : clearProduct())} trackedOnly />
          </div>

          {lookupBusy ? <p className="text-xs text-muted-foreground">{t('receiving.looking')}</p> : null}
          {lookupError ? (
            <p className="text-xs font-medium text-destructive" role="alert">
              {lookupError}
            </p>
          ) : null}
          {unknownCode ? (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200"
              role="alert"
            >
              <span>{t('receiving.unknown', { code: unknownCode })}</span>
              {/* the wedge listener is paused while the create dialog is open (it has its own) */}
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <PackagePlus className="h-3.5 w-3.5" /> {t('receiving.createProduct')}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {product ? (
        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
            <div>
              <CardTitle>{productName(product, i18n.language)}</CardTitle>
              <CardDescription>
                <span className="font-mono">{product.sku}</span>
                {product.location ? ` · ${t('receiving.shelf', { location: product.location })}` : ''}
                {' · '}
                {t('receiving.inStock', { qty: product.stockQty ?? 0 })}
                {' · '}
                {t('receiving.lastCost', { cost: fmtEUR(product.costCents) })}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={clearProduct}>
              <X className="h-3.5 w-3.5" /> {t('receiving.clear')}
            </Button>
          </CardHeader>
          <CardContent>
            {!product.trackStock ? (
              <p className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm" role="alert">
                {t('receiving.serviceWarning')}
              </p>
            ) : (
              <form onSubmit={handleSubmit((v) => receive.mutate(v))} className="space-y-3" noValidate>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label={t('receiving.qty')} error={errors.qty?.message} required>
                    <Input
                      inputMode="numeric"
                      className="h-11 text-base"
                      {...qtyField}
                      ref={(el) => {
                        qtyRegisterRef(el);
                        qtyRef.current = el;
                      }}
                    />
                  </Field>
                  <Field label={t('receiving.unitCost')} error={errors.unitCost?.message} hint={t('receiving.unitCostHint')}>
                    <Input inputMode="decimal" className="h-11 text-base" {...register('unitCost')} />
                  </Field>
                  <Field label={t('form.supplier')} error={errors.supplierId?.message}>
                    <Select className="h-11" {...register('supplierId')}>
                      <option value="">{t('common:common.none')}</option>
                      {(suppliers.data?.suppliers ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <div className="rounded-md border">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-expanded={showImport}
                    aria-controls="receiving-import-costs"
                    onClick={() => setShowImport((v) => !v)}
                  >
                    {showImport ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {t('receiving.importCosts')}
                    <span className="text-2xs font-normal text-muted-foreground">({t('common:common.optional')})</span>
                    {landed && landed.extras > 0 && !showImport ? (
                      <Badge variant="info" className="ml-auto">
                        {fmtEUR(landed.extras)}
                      </Badge>
                    ) : null}
                  </button>
                  {showImport ? (
                    <div id="receiving-import-costs" className="grid gap-3 border-t p-3 sm:grid-cols-3">
                      <Field label={t('receiving.shipping')} error={errors.shipping?.message}>
                        <Input inputMode="decimal" {...register('shipping')} />
                      </Field>
                      <Field label={t('receiving.customs')} error={errors.customs?.message}>
                        <Input inputMode="decimal" {...register('customs')} />
                      </Field>
                      <Field label={t('receiving.importVat')} error={errors.importVat?.message}>
                        <Input inputMode="decimal" {...register('importVat')} />
                      </Field>
                      <p className="text-2xs text-muted-foreground sm:col-span-3">{t('receiving.importHint')}</p>
                    </div>
                  ) : null}
                </div>

                <Field label={t('common:common.notes')} error={errors.notes?.message}>
                  <Textarea rows={2} placeholder={t('receiving.notesPlaceholder')} {...register('notes')} />
                </Field>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground" aria-live="polite">
                    {landed
                      ? t('receiving.landedPreview', { perUnit: fmtEUR(landed.perUnit), total: fmtEUR(landed.total) })
                      : t('receiving.noCost')}
                  </p>
                  <Button type="submit" size="pos" disabled={receive.isPending}>
                    <PackagePlus className="h-5 w-5" /> {t('receiving.submit')}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('receiving.todayTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {todays.isLoading ? (
            <LoadingState />
          ) : todays.isError ? (
            <ErrorState error={todays.error} onRetry={() => void todays.refetch()} />
          ) : receipts.length === 0 ? (
            <EmptyState title={t('receiving.todayEmpty')} hint={t('receiving.todayEmptyHint')} />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>{t('movements.time')}</TH>
                  <TH>{t('products.sku')}</TH>
                  <TH>{t('products.name')}</TH>
                  <TH className="text-right">{t('receiving.qty')}</TH>
                  <TH className="text-right">{t('receiving.landedUnit')}</TH>
                  <TH className="text-right">{t('common:common.total')}</TH>
                  <TH>{t('form.supplier')}</TH>
                  <TH>{t('common:common.notes')}</TH>
                </TR>
              </THead>
              <TBody>
                {receipts.map((m) => (
                  <TR key={m.id}>
                    <TD className="tabular-nums">{fmtTime(m.createdAt)}</TD>
                    <TD className="font-mono text-xs">{m.product.sku}</TD>
                    <TD>{m.product.nameEn}</TD>
                    <TD className="text-right tabular-nums text-profit">+{m.qty}</TD>
                    <TDMoney>{fmtEUR(m.unitCostCents)}</TDMoney>
                    <TDMoney>{m.unitCostCents !== null ? fmtEUR(m.qty * m.unitCostCents) : '–'}</TDMoney>
                    <TD>{m.supplier?.name ?? '–'}</TD>
                    <TD className="max-w-[16rem] truncate text-muted-foreground" title={m.notes ?? undefined}>
                      {m.notes ?? ''}
                    </TD>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD colSpan={3}>{t('receiving.receiptCount', { count: receipts.length })}</TD>
                  <TD className="text-right tabular-nums">+{receipts.reduce((s, m) => s + m.qty, 0)}</TD>
                  <TD />
                  <TDMoney>{fmtEUR(receiptsValue)}</TDMoney>
                  <TD colSpan={2} />
                </TR>
              </TFoot>
            </Table>
          )}
        </CardContent>
      </Card>

      <CameraScanDialog
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onDetected={(scanned) => {
          setCameraOpen(false);
          void lookup(scanned);
        }}
      />
      <ProductFormDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        product={null}
        initialBarcode={unknownCode}
        categories={categories.data ?? []}
        onSaved={(created) => choose(created)}
      />
    </div>
  );
}
