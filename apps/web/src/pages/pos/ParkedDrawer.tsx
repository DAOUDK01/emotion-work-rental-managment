import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Play, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { cn } from '@/components/ui/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { errMsg, modelName, type SaleListResponse, type SaleResponse, type SaleSummary } from './types';

/** Right-hand drawer listing parked sales: resume or void (DELETE → VOID, confirmed). */
export function ParkedDrawer({
  open,
  onClose,
  parked,
  currentSaleId,
  onResume,
  onVoided,
}: {
  open: boolean;
  onClose: () => void;
  parked: UseQueryResult<SaleListResponse>;
  currentSaleId: number | null;
  onResume: (id: number) => void;
  onVoided: (id: number) => void;
}) {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const queryClient = useQueryClient();
  const [toVoid, setToVoid] = useState<SaleSummary | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !toVoid) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, toVoid]);

  const voidSale = useMutation({
    mutationFn: (id: number) => api.del<SaleResponse>(`/pos/sales/${id}`),
    onSuccess: (res) => {
      toast.success(t('parked.voided', { number: res.sale.number }));
      void queryClient.invalidateQueries({ queryKey: ['pos', 'sales'] });
      onVoided(res.sale.id);
      setToVoid(null);
    },
    onError: (err) => toast.error(errMsg(err)),
  });

  if (!open) return null;
  const sales = parked.data?.sales ?? [];

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onMouseDown={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t('parked.title')}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-card shadow-2xl focus:outline-none"
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-sm font-semibold">
            {t('parked.title')} {sales.length > 0 ? <Badge variant="info">{sales.length}</Badge> : null}
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label={t('common:action.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {parked.isLoading ? <LoadingState label={t('common:common.loading')} /> : null}
          {parked.isError ? <ErrorState error={parked.error} onRetry={() => void parked.refetch()} /> : null}
          {parked.isSuccess && sales.length === 0 ? (
            <EmptyState title={t('parked.empty')} hint={t('parked.emptyHint')} />
          ) : null}
          {sales.map((s) => {
            const current = s.id === currentSaleId;
            return (
              <div
                key={s.id}
                className={cn('space-y-2 rounded-lg border p-3', current && 'border-primary ring-1 ring-primary')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      {s.number}
                      {current ? <Badge variant="info">{t('parked.current')}</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {fmtDate(s.businessDate)} · {modelName(s.model, lang)} · {s.customer?.name ?? t('cart.walkIn')}
                    </p>
                    <p className="text-xs text-muted-foreground">{t('parked.lines', { count: s.lineCount })}</p>
                  </div>
                  <span className="text-base font-bold tabular-nums">{fmtEUR(s.totalGrossCents)}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    size="lg"
                    disabled={current}
                    onClick={() => {
                      onResume(s.id);
                      onClose();
                    }}
                  >
                    <Play className="h-4 w-4" /> {t('parked.resume')}
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => setToVoid(s)} aria-label={t('parked.void')}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <ConfirmDialog
        open={toVoid !== null}
        onClose={() => setToVoid(null)}
        onConfirm={() => {
          if (toVoid) voidSale.mutate(toVoid.id);
        }}
        title={t('parked.voidTitle')}
        message={t('parked.voidMessage', { number: toVoid?.number ?? '', amount: fmtEUR(toVoid?.totalGrossCents ?? 0) })}
        confirmLabel={t('common:action.void')}
        busy={voidSale.isPending}
      />
    </>
  );
}
