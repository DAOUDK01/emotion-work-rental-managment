import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { todayInHelsinki } from '@emotionfix/shared';
import { Plus } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { centsToInput, euroInputToCents } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Field, Input, Select } from '@/components/ui/input';
import { BarcodeEditor, type DraftBarcode } from './BarcodeEditor';
import { checkBarcode, fmtVatBp, type InventoryLookups, type Product, type Supplier } from './types';

interface FormValues {
  nameEn: string;
  nameFi: string;
  sku: string;
  category: string;
  brand: string;
  compatibleUnits: string;
  cost: string;
  price: string;
  wholesale: string;
  vatRateBp: string;
  trackStock: boolean;
  reorderLevel: string;
  location: string;
  supplierId: string;
  initialStock: string;
}

const nonNegativeMoney = (v: string) => {
  if (v.trim() === '') return true;
  const c = euroInputToCents(v);
  return c !== null && c >= 0;
};

const moneyOrNull = (v: string): number | null => (v.trim() === '' ? null : euroInputToCents(v));

/** Create / edit a product (catalogue item, spare part or service). */
export function ProductFormDialog({
  open,
  onClose,
  product,
  initialBarcode,
  categories,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  product: Product | null; // null = create
  initialBarcode?: string | null;
  categories: string[];
  onSaved?: (product: Product) => void;
}) {
  const { t, i18n } = useTranslation('inventory');
  const queryClient = useQueryClient();
  const [barcodes, setBarcodes] = useState<DraftBarcode[]>([]);
  const [newSupplierOpen, setNewSupplierOpen] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [pendingSupplierId, setPendingSupplierId] = useState<number | null>(null);
  const pendingBarcode = useRef<() => DraftBarcode[] | null>(() => []);

  const lookups = useQuery({
    queryKey: ['lookups'],
    queryFn: () => api.get<InventoryLookups>('/lookups'),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const suppliers = useQuery({
    queryKey: ['products', 'suppliers'],
    queryFn: () => api.get<{ suppliers: Supplier[] }>('/products/suppliers' + qs({ active: 'true', pageSize: 200 })),
    staleTime: 60_000,
    enabled: open,
  });

  const vatOptions = useMemo(() => {
    const rates = new Set<number>((lookups.data?.vatRates ?? []).map((r) => r.rateBp));
    if (product) rates.add(product.vatRateBp);
    return [...rates].sort((a, b) => b - a);
  }, [lookups.data, product]);

  const currentVat = useMemo(() => {
    const today = todayInHelsinki();
    return (lookups.data?.vatRates ?? [])
      .filter((r) => r.isDefault && r.validFrom <= today)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.rateBp;
  }, [lookups.data]);

  const schema = useMemo(
    () =>
      z
        .object({
          nameEn: z.string().trim().min(1, t('form.nameRequired')).max(200),
          nameFi: z.string().trim().max(200),
          sku: z.string().trim().max(40),
          category: z.string().trim().max(100),
          brand: z.string().trim().max(100),
          compatibleUnits: z.string().trim().max(500),
          cost: z.string().refine(nonNegativeMoney, t('form.badAmount')),
          price: z
            .string()
            .refine((v) => v.trim() !== '', t('form.priceRequired'))
            .refine(nonNegativeMoney, t('form.badAmount')),
          wholesale: z.string().refine(nonNegativeMoney, t('form.badAmount')),
          vatRateBp: z.string(),
          trackStock: z.boolean(),
          reorderLevel: z.string(),
          location: z.string().trim().max(100),
          supplierId: z.string(),
          initialStock: z.string(),
        })
        .superRefine((v, ctx) => {
          // stock fields only matter (and are only shown) for stock-tracked products
          if (!v.trackStock) return;
          if (!/^\d{1,6}$/.test(v.reorderLevel.trim())) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reorderLevel'], message: t('form.badWholeNumber') });
          }
          if (!/^\d{0,6}$/.test(v.initialStock.trim())) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['initialStock'], message: t('form.badWholeNumber') });
          }
        }),
    [t],
  );

  const defaults = useMemo<FormValues>(
    () => ({
      nameEn: product?.nameEn ?? '',
      nameFi: product?.nameFi ?? '',
      sku: product?.sku ?? '',
      category: product?.category ?? '',
      brand: product?.brand ?? '',
      compatibleUnits: product?.compatibleUnits ?? '',
      cost: centsToInput(product?.costCents),
      price: centsToInput(product?.priceCents),
      wholesale: centsToInput(product?.wholesaleCents),
      vatRateBp: product ? String(product.vatRateBp) : '',
      trackStock: product?.trackStock ?? true,
      reorderLevel: String(product?.reorderLevel ?? 0),
      location: product?.location ?? '',
      supplierId: product?.supplierId != null ? String(product.supplierId) : '',
      initialStock: '',
    }),
    [product],
  );

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults });

  useEffect(() => {
    if (!open) return;
    reset(defaults);
    setNewSupplierOpen(false);
    setNewSupplierName('');
    setPendingSupplierId(null);
    if (product) setBarcodes(product.barcodes.map((b) => ({ barcode: b.barcode, type: b.type })));
    else {
      const check = initialBarcode ? checkBarcode(initialBarcode) : null;
      setBarcodes(check?.ok && initialBarcode ? [{ barcode: initialBarcode.trim(), type: check.type }] : []);
    }
  }, [open, defaults, reset, product, initialBarcode]);

  const trackStock = watch('trackStock');

  const supplierMutation = useMutation({
    mutationFn: (name: string) => api.post<{ supplier: Supplier }>('/products/suppliers', { name }),
    onSuccess: ({ supplier }) => {
      toast.success(t('supplier.created', { name: supplier.name }));
      queryClient.setQueryData<{ suppliers: Supplier[] }>(['products', 'suppliers'], (old) =>
        old ? { suppliers: [...old.suppliers, supplier].sort((a, b) => a.name.localeCompare(b.name)) } : old,
      );
      void queryClient.invalidateQueries({ queryKey: ['products', 'suppliers'] });
      setPendingSupplierId(supplier.id); // selected once its <option> has rendered
      setNewSupplierOpen(false);
      setNewSupplierName('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const mutation = useMutation({
    mutationFn: ({ values, codes }: { values: FormValues; codes: DraftBarcode[] }) => {
      const body = {
        ...(values.sku.trim() ? { sku: values.sku.trim() } : {}),
        nameEn: values.nameEn.trim(),
        nameFi: values.nameFi.trim() || null,
        category: values.category.trim() || null,
        brand: values.brand.trim() || null,
        compatibleUnits: values.compatibleUnits.trim() || null,
        costCents: moneyOrNull(values.cost),
        priceCents: euroInputToCents(values.price) ?? 0,
        wholesaleCents: moneyOrNull(values.wholesale),
        ...(values.vatRateBp ? { vatRateBp: Number(values.vatRateBp) } : {}),
        trackStock: values.trackStock,
        reorderLevel: values.trackStock ? Number(values.reorderLevel.trim()) : (product?.reorderLevel ?? 0),
        location: values.location.trim() || null,
        supplierId: values.supplierId === '' ? null : Number(values.supplierId),
        barcodes: codes.map((b) => ({ barcode: b.barcode, type: b.type })),
        ...(!product && values.trackStock && Number(values.initialStock.trim()) > 0
          ? { initialStock: Number(values.initialStock.trim()) }
          : {}),
      };
      return product
        ? api.put<{ product: Product }>(`/products/${product.id}`, body)
        : api.post<{ product: Product }>('/products', body);
    },
    onSuccess: ({ product: saved }) => {
      toast.success(t('common:common.savedOk'));
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      onSaved?.(saved);
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const supplierList = useMemo(() => {
    const list = suppliers.data?.suppliers ?? [];
    const current = product?.supplier ?? null;
    if (current && !list.some((s) => s.id === current.id)) {
      // keep an inactive current supplier selectable so editing does not drop it
      return [...list, { ...current, contact: null, email: null, notes: null, productCount: 0 }];
    }
    return list;
  }, [suppliers.data, product]);

  // the native select can only show the chosen supplier once its <option> exists: re-sync after load
  useEffect(() => {
    if (open && suppliers.data) setValue('supplierId', getValues('supplierId'));
  }, [open, suppliers.data, setValue, getValues]);

  useEffect(() => {
    if (pendingSupplierId !== null && supplierList.some((s) => s.id === pendingSupplierId)) {
      setValue('supplierId', String(pendingSupplierId), { shouldDirty: true });
      setPendingSupplierId(null);
    }
  }, [pendingSupplierId, supplierList, setValue]);

  const submit = handleSubmit((values) => {
    const codes = pendingBarcode.current();
    if (!codes) return; // a typed barcode is invalid — its error is shown in the editor
    mutation.mutate({ values, codes });
  });

  return (
    <Dialog open={open} onClose={onClose} title={product ? t('form.editTitle', { sku: product.sku }) : t('form.createTitle')} wide>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('form.nameEn')} error={errors.nameEn?.message} required>
            <Input autoFocus {...register('nameEn')} />
          </Field>
          <Field label={t('form.nameFi')} error={errors.nameFi?.message}>
            <Input {...register('nameFi')} />
          </Field>
          <Field label={t('form.sku')} error={errors.sku?.message} hint={product ? undefined : t('form.skuHint')}>
            <Input placeholder={product ? undefined : 'P-000123'} autoComplete="off" {...register('sku')} />
          </Field>
          <Field label={t('form.category')} error={errors.category?.message}>
            <Input list="inventory-categories" autoComplete="off" {...register('category')} />
            <datalist id="inventory-categories">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </Field>
          <Field label={t('form.brand')} error={errors.brand?.message}>
            <Input {...register('brand')} />
          </Field>
          <Field label={t('form.compatibleUnits')} error={errors.compatibleUnits?.message} hint={t('form.compatibleHint')}>
            <Input {...register('compatibleUnits')} />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('form.cost')} error={errors.cost?.message} hint={t('form.costHint')}>
            <Input inputMode="decimal" placeholder="12,40" {...register('cost')} />
          </Field>
          <Field label={t('form.price')} error={errors.price?.message} hint={t('form.priceHint')} required>
            <Input inputMode="decimal" placeholder="24,90" {...register('price')} />
          </Field>
          <Field label={t('form.wholesale')} error={errors.wholesale?.message} hint={t('form.wholesaleHint')}>
            <Input inputMode="decimal" {...register('wholesale')} />
          </Field>
          <Field label={t('common:money.vatRate')} error={errors.vatRateBp?.message}>
            <Select {...register('vatRateBp')}>
              {!product ? (
                <option value="">
                  {currentVat !== undefined
                    ? t('form.vatCurrent', { rate: fmtVatBp(currentVat, i18n.language) })
                    : t('form.vatCurrentPlain')}
                </option>
              ) : null}
              {vatOptions.map((bp) => (
                <option key={bp} value={bp}>
                  {fmtVatBp(bp, i18n.language)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col justify-center gap-1 sm:col-span-2 lg:col-span-1">
            <Checkbox
              label={t('form.trackStock')}
              checked={trackStock}
              onChange={(e) => setValue('trackStock', e.target.checked, { shouldDirty: true })}
            />
            <p className="text-2xs text-muted-foreground">{t('form.trackStockHint')}</p>
          </div>
          {trackStock ? (
            <Field label={t('form.reorderLevel')} error={errors.reorderLevel?.message} hint={t('form.reorderHint')}>
              <Input inputMode="numeric" {...register('reorderLevel')} />
            </Field>
          ) : null}
          <Field label={t('form.location')} error={errors.location?.message}>
            <Input placeholder={t('form.locationPlaceholder')} {...register('location')} />
          </Field>
          {!product && trackStock ? (
            <Field label={t('form.initialStock')} error={errors.initialStock?.message} hint={t('form.initialStockHint')}>
              <Input inputMode="numeric" placeholder="0" {...register('initialStock')} />
            </Field>
          ) : null}
        </div>

        <div className="space-y-2">
          <Field label={t('form.supplier')} error={errors.supplierId?.message}>
            <div className="flex gap-2">
              <Select className="min-w-0 flex-1" {...register('supplierId')}>
                <option value="">{t('common:common.none')}</option>
                {supplierList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Button
                variant="outline"
                onClick={() => setNewSupplierOpen((v) => !v)}
                aria-expanded={newSupplierOpen}
              >
                <Plus className="h-3.5 w-3.5" /> {t('supplier.new')}
              </Button>
            </div>
          </Field>
          {newSupplierOpen ? (
            <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-3">
              <Field label={t('supplier.name')} className="min-w-[12rem] flex-1">
                <Input
                  autoFocus
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newSupplierName.trim()) supplierMutation.mutate(newSupplierName.trim());
                    }
                  }}
                />
              </Field>
              <Button
                onClick={() => supplierMutation.mutate(newSupplierName.trim())}
                disabled={!newSupplierName.trim() || supplierMutation.isPending}
              >
                {t('supplier.create')}
              </Button>
            </div>
          ) : null}
        </div>

        <BarcodeEditor
          value={barcodes}
          onChange={setBarcodes}
          productId={product?.id ?? null}
          active={open}
          pendingRef={pendingBarcode}
        />

        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            {t('common:action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
