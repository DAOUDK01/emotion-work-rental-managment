import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Bike, Search, UserRound, X } from 'lucide-react';
import { api, qs } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/input';
import { ErrorState, Segmented, Spinner } from '@/components/ui/misc';
import {
  errMsg,
  modelName,
  type CustomerListResponse,
  type Lookups,
  type Sale,
  type UnitListResponse,
} from './types';

/** The POS sells under these three business models (in this order). */
export const POS_MODEL_CODES = ['REPAIR', 'SPARE_PARTS', 'UNIT_SALES'] as const;

export interface SaleDetailsBody {
  modelId: number;
  customerId: number | null;
  unitId: number | null;
  notes: string | null;
}

function useDebounced(value: string, ms = 250): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Search-as-you-type picker list (customers / units). */
function PickerResults<T extends { id: number }>({
  query,
  isLoading,
  isError,
  error,
  onRetry,
  rows,
  render,
  onPick,
  emptyLabel,
}: {
  query: string;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  rows: T[];
  render: (row: T) => React.ReactNode;
  onPick: (row: T) => void;
  emptyLabel: string;
}) {
  if (!query) return null;
  if (isLoading)
    return (
      <div className="flex justify-center py-3">
        <Spinner className="h-5 w-5" />
      </div>
    );
  if (isError) return <ErrorState error={error} onRetry={onRetry} />;
  if (rows.length === 0) return <p className="py-2 text-xs text-muted-foreground">{emptyLabel}</p>;
  return (
    <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            className="w-full px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            onClick={() => onPick(row)}
          >
            {render(row)}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Customer picker + optional unit + business model + notes for the open sale (PUT /pos/sales/:id). */
export function SaleDetailsDialog({
  open,
  sale,
  lookups,
  defaultModelId,
  onClose,
  onSubmit,
}: {
  open: boolean;
  sale: Sale | undefined;
  lookups: Lookups | undefined;
  defaultModelId: number | null;
  onClose: () => void;
  onSubmit: (body: SaleDetailsBody) => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const [modelId, setModelId] = useState<number>(0);
  const [customer, setCustomer] = useState<{ id: number; name: string } | null>(null);
  const [unit, setUnit] = useState<{ id: number; code: string; brand: string } | null>(null);
  const [notes, setNotes] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [unitSearch, setUnitSearch] = useState('');
  const customerQ = useDebounced(customerSearch);
  const unitQ = useDebounced(unitSearch);

  useEffect(() => {
    if (!open) return;
    setModelId(sale?.model.id ?? defaultModelId ?? 0);
    setCustomer(sale?.customer ? { id: sale.customer.id, name: sale.customer.name } : null);
    setUnit(sale?.unit ?? null);
    setNotes(sale?.notes ?? '');
    setCustomerSearch('');
    setUnitSearch('');
  }, [open, sale, defaultModelId]);

  const models = (lookups?.models ?? []).filter((m) =>
    (POS_MODEL_CODES as readonly string[]).includes(m.code),
  );
  const modelOptions = (models.length > 0 ? models : lookups?.models ?? []).map((m) => ({
    value: m.id,
    label: modelName(m, lang),
  }));

  const customers = useQuery({
    queryKey: ['customers', 'pos-picker', customerQ],
    queryFn: () => api.get<CustomerListResponse>('/customers' + qs({ q: customerQ, pageSize: 10 })),
    enabled: open && customerQ.length > 0,
    staleTime: 30_000,
  });
  const units = useQuery({
    queryKey: ['units', 'pos-picker', unitQ],
    queryFn: () => api.get<UnitListResponse>('/units' + qs({ q: unitQ, pageSize: 10 })),
    enabled: open && unitQ.length > 0,
    staleTime: 30_000,
  });

  const save = useMutation({
    mutationFn: onSubmit,
    onSuccess: () => {
      toast.success(t('common:common.savedOk'));
      onClose();
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('details.title')}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            {t('common:action.cancel')}
          </Button>
          <Button
            disabled={save.isPending || !modelId}
            onClick={() =>
              save.mutate({ modelId, customerId: customer?.id ?? null, unitId: unit?.id ?? null, notes: notes.trim() || null })
            }
          >
            {t('common:action.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium">{t('details.model')}</p>
          {modelOptions.length > 0 ? (
            <Segmented value={modelId} onChange={setModelId} options={modelOptions} />
          ) : (
            <Spinner className="h-5 w-5" />
          )}
        </div>

        <Field label={t('details.customer')} hint={t('details.customerHint')}>
          {customer ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <UserRound className="h-4 w-4 text-muted-foreground" /> {customer.name}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setCustomer(null)} aria-label={t('details.clearCustomer')}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder={t('details.customerSearch')}
                  aria-label={t('details.customerSearch')}
                />
              </div>
              <PickerResults
                query={customerQ}
                isLoading={customers.isLoading}
                isError={customers.isError}
                error={customers.error}
                onRetry={() => void customers.refetch()}
                rows={customers.data?.customers ?? []}
                emptyLabel={t('details.noCustomers')}
                onPick={(c) => setCustomer({ id: c.id, name: c.name })}
                render={(c) => (
                  <span className="flex justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.city ?? c.email ?? ''}</span>
                  </span>
                )}
              />
            </div>
          )}
        </Field>

        <Field label={t('details.unit')} hint={t('details.unitHint')}>
          {unit ? (
            <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Bike className="h-4 w-4 text-muted-foreground" /> {unit.code} · {unit.brand}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setUnit(null)} aria-label={t('details.clearUnit')}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  value={unitSearch}
                  onChange={(e) => setUnitSearch(e.target.value)}
                  placeholder={t('details.unitSearch')}
                  aria-label={t('details.unitSearch')}
                />
              </div>
              <PickerResults
                query={unitQ}
                isLoading={units.isLoading}
                isError={units.isError}
                error={units.error}
                onRetry={() => void units.refetch()}
                rows={units.data?.units ?? []}
                emptyLabel={t('details.noUnits')}
                onPick={(u) => setUnit({ id: u.id, code: u.code, brand: u.brand })}
                render={(u) => (
                  <span className="flex justify-between gap-2">
                    <span className="font-medium">{u.code}</span>
                    <span className="text-xs text-muted-foreground">
                      {u.brand}
                      {u.modelName ? ` ${u.modelName}` : ''}
                    </span>
                  </span>
                )}
              />
            </div>
          )}
        </Field>

        <Field label={t('common:common.notes')}>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </Field>
      </div>
    </Dialog>
  );
}
