import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileText, ImagePlus, Pencil, Tag, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtEUR, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Badge, ErrorState, LoadingState } from '@/components/ui/misc';
import { statusBadgeVariant, type Unit, type UnitDetail, type UnitEntry } from './types';

const paymentBadge: Record<UnitEntry['paymentStatus'], 'success' | 'info' | 'warning'> = {
  PAID: 'success',
  INVOICED: 'info',
  PENDING: 'warning',
  NOT_YET_BILLED: 'warning',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-sm">{children}</span>
    </div>
  );
}

/** Right-side detail panel: every field, lifetime result, last entries, photos, actions. */
export default function UnitDetailDrawer({
  unitId,
  onClose,
  onEdit,
  onSell,
}: {
  unitId: number | null;
  onClose: () => void;
  onEdit: (unit: Unit) => void;
  onSell: (unit: Unit) => void;
}) {
  const { t, i18n } = useTranslation('units');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  const open = unitId !== null;
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A dialog stacked on top of the drawer (edit / sell / void) closes first.
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      onClose();
    };
    // Capture phase: runs before the stacked dialog's own Escape handler removes it.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const closeVoid = () => {
    setVoidOpen(false);
    setVoidReason('');
  };

  const detail = useQuery({
    queryKey: ['units', unitId],
    queryFn: () => api.get<{ unit: UnitDetail }>(`/units/${unitId}`),
    enabled: open,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('unitId', String(unitId));
      return api.post<{ attachment: { id: number } }>('/attachments', fd);
    },
    onSuccess: () => {
      toast.success(t('photos.uploaded'));
      void queryClient.invalidateQueries({ queryKey: ['units', unitId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const voidMutation = useMutation({
    mutationFn: () => api.post<{ unit: Unit }>(`/units/${unitId}/void`, { reason: voidReason.trim() }),
    onSuccess: () => {
      toast.success(t('common:common.voidedOk'));
      closeVoid();
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) return null;
  const u = detail.data?.unit;
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const isAdmin = user?.role === 'ADMIN';
  const modelName = (e: UnitEntry) => (i18n.language === 'fi' ? e.model.nameFi : e.model.nameEn);

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t('detail.title')}
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between border-b bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">{u ? u.code : t('detail.title')}</h2>
            {u && !u.active ? <Badge variant="danger">{t('detail.archived')}</Badge> : null}
            {u?.needsReview ? (
              <Badge variant="warning" title={u.reviewReason ?? undefined}>
                {t('common:common.needsReview')}
              </Badge>
            ) : null}
          </div>
          <Button
            ref={closeButton}
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label={t('common:action.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {detail.isLoading ? <LoadingState /> : null}
          {detail.isError ? (
            <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />
          ) : null}
          {u ? (
            <div className="space-y-5">
              {/* actions */}
              {canWrite && u.active ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(u)}>
                    <Pencil className="h-3.5 w-3.5" /> {t('common:action.edit')}
                  </Button>
                  {u.status !== 'SOLD' ? (
                    <Button size="sm" onClick={() => onSell(u)}>
                      {t('actions.sell')}
                    </Button>
                  ) : null}
                  {isAdmin ? (
                    <Button size="sm" variant="destructive" onClick={() => setVoidOpen(true)}>
                      <Trash2 className="h-3.5 w-3.5" /> {t('common:action.void')}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {/* all fields */}
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  {t('detail.fields')}
                </h3>
                <Row label={t('table.brand')}>
                  {u.brand}
                  {u.modelName ? ` — ${u.modelName}` : ''}
                </Row>
                {u.legacyName ? <Row label={t('detail.legacyName')}>{u.legacyName}</Row> : null}
                <Row label={t('table.category')}>{t(`category.${u.category}`)}</Row>
                <Row label={t('common:common.status')}>
                  <Badge variant={statusBadgeVariant(u.status)}>{t(`status.${u.status}`)}</Badge>
                </Row>
                {u.inclusions ? <Row label={t('form.inclusions')}>{u.inclusions}</Row> : null}
                <Row label={t('form.purchaseDate')}>{fmtDate(u.purchaseDate)}</Row>
                <Row label={t('form.purchasePrice')}>{fmtEUR(u.purchaseCents)}</Row>
                {u.sellerName ? <Row label={t('form.seller')}>{u.sellerName}</Row> : null}
                <Row label={t('form.owner')}>{u.owner?.name ?? '–'}</Row>
                <Row label={t('common:money.paidBy')}>{u.paidBy?.name ?? '–'}</Row>
                {u.status === 'SOLD' ? (
                  <>
                    <Row label={t('detail.soldFor')}>{fmtEUR(u.soldCents)}</Row>
                    <Row label={t('detail.soldDate')}>{fmtDate(u.soldDate)}</Row>
                    <Row label={t('sell.buyer')}>{u.soldToCustomer?.name ?? '–'}</Row>
                  </>
                ) : null}
                {u.notes ? <Row label={t('common:common.notes')}>{u.notes}</Row> : null}
              </section>

              {/* money */}
              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                  {t('detail.result')}
                </h3>
                <Row label={t('table.earned')}>{fmtEUR(u.earnedCents)}</Row>
                <Row label={t('detail.partsUsed')}>{fmtEUR(u.partsCents)}</Row>
                <Row label={t('table.payback')}>
                  {u.paidBack ? (
                    <Badge variant="success">{t('table.paidBack')}</Badge>
                  ) : u.paybackPct !== null ? (
                    `${fmtPct(u.paybackPct)} · ${t('detail.remaining')} ${fmtEUR(u.remainingCents)}`
                  ) : (
                    '–'
                  )}
                </Row>
                {u.saleProfitCents !== null ? (
                  <Row label={t('table.saleResult')}>
                    <span className={u.saleProfitCents < 0 ? 'font-semibold text-loss' : 'font-semibold text-profit'}>
                      {fmtEUR(u.saleProfitCents, { sign: true })}
                    </span>
                  </Row>
                ) : null}
                <Row label={t('detail.lifetime')}>
                  <span className={u.lifetimeCents < 0 ? 'font-semibold text-loss' : 'font-semibold text-profit'}>
                    {fmtEUR(u.lifetimeCents, { sign: true })}
                  </span>
                </Row>
              </section>

              {/* last entries */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  {t('detail.lastEntries')}
                </h3>
                {u.entries.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('detail.noEntries')}</p>
                ) : (
                  <ul className="space-y-1">
                    {u.entries.map((e) => (
                      <li key={e.id} className="flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-xs">
                        <div className="min-w-0">
                          <span className="tabular-nums text-muted-foreground">{fmtDate(e.entryDate)}</span>{' '}
                          <span className="font-medium">{modelName(e)}</span>
                          {e.description ? (
                            <span className="block truncate text-muted-foreground">{e.description}</span>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge variant={e.status === 'VOID' ? 'danger' : paymentBadge[e.paymentStatus]}>
                            {e.status === 'VOID' ? t('common:status.VOID') : t(`common:status.${e.paymentStatus}`)}
                          </Badge>
                          <span className="tabular-nums font-medium">{fmtEUR(e.netCents)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* photos / attachments */}
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t('photos.title')}
                  </h3>
                  {canWrite ? (
                    <>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/heic,application/pdf"
                        className="sr-only"
                        aria-label={t('photos.add')}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) upload.mutate(file);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={upload.isPending}
                        onClick={() => fileInput.current?.click()}
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        {upload.isPending ? t('photos.uploading') : t('photos.add')}
                      </Button>
                    </>
                  ) : null}
                </div>
                {u.attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('photos.empty')}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {u.attachments.map((a) =>
                      a.mimeType.startsWith('image/') ? (
                        <a
                          key={a.id}
                          href={`/api/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block overflow-hidden rounded-md border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={a.fileName}
                        >
                          <img
                            src={`/api/attachments/${a.id}`}
                            alt={a.fileName}
                            loading="lazy"
                            className="aspect-square w-full object-cover"
                          />
                        </a>
                      ) : (
                        <a
                          key={a.id}
                          href={`/api/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex aspect-square flex-col items-center justify-center gap-1 rounded-md border p-2 text-center text-2xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={a.fileName}
                        >
                          <FileText className="h-6 w-6" />
                          <span className="line-clamp-2 break-all">{a.fileName}</span>
                        </a>
                      ),
                    )}
                  </div>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={voidOpen}
        onClose={closeVoid}
        onConfirm={() => {
          if (voidReason.trim() === '') {
            toast.error(t('void.reasonRequired'));
            return;
          }
          voidMutation.mutate();
        }}
        title={t('void.title', { code: u?.code ?? '' })}
        message={t('void.message')}
        confirmLabel={t('common:action.void')}
        busy={voidMutation.isPending}
      >
        <div className="mt-3">
          <Field label={t('void.reason')} required>
            <Input
              value={voidReason}
              onChange={(e) => setVoidReason(e.target.value)}
              placeholder={t('void.reasonPlaceholder')}
            />
          </Field>
        </div>
      </ConfirmDialog>
    </div>
  );
}
