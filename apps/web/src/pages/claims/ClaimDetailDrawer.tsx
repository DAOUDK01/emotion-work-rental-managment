import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowRightLeft, FileText, Image as ImageIcon, Paperclip, Pencil, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, ErrorState, LoadingState } from '@/components/ui/misc';
import { StatusTimeline } from './StatusTimeline';
import {
  ACCEPTED_FILES,
  MAX_UPLOAD_BYTES,
  errorMessage,
  fmtFileSize,
  type Claim,
  type ClaimAttachment,
  type ClaimResponse,
} from './types';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-sm">{children}</span>
    </div>
  );
}

/** Right-side panel: every field of a claim, its progress and the case documents. */
export function ClaimDetailDrawer({
  claimId,
  onClose,
  onEdit,
  onChangeStatus,
}: {
  claimId: number | null;
  onClose: () => void;
  onEdit: (claim: Claim) => void;
  onChangeStatus: (claim: Claim) => void;
}) {
  const { t, i18n } = useTranslation('claims');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [toDelete, setToDelete] = useState<ClaimAttachment | null>(null);

  const open = claimId !== null;
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A dialog stacked on top of the drawer closes first.
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      onClose();
    };
    // Capture phase: runs before the stacked dialog's own Escape handler removes it.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const detail = useQuery({
    queryKey: ['claims', claimId],
    queryFn: () => api.get<ClaimResponse>(`/claims/${claimId}`),
    enabled: open,
  });

  const upload = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('claimId', String(claimId));
      return api.post<{ attachment: { id: number } }>('/attachments', fd);
    },
    onSuccess: () => {
      toast.success(t('detail.uploaded'));
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  const remove = useMutation({
    mutationFn: (attachmentId: number) => api.del<{ ok: true }>(`/attachments/${attachmentId}`),
    onSuccess: () => {
      toast.success(t('detail.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (err) => toast.error(errorMessage(err, t('common:common.errorTitle'))),
  });

  if (!open) return null;
  const c = detail.data?.claim;
  const productName = c?.product ? (i18n.language === 'fi' && c.product.nameFi ? c.product.nameFi : c.product.nameEn) : null;
  const difference = c && c.claimedCents !== null && c.approvedCents !== null ? c.approvedCents - c.claimedCents : null;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(t('detail.fileTooLarge'));
      return;
    }
    upload.mutate(file);
  };

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
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <h2 className="truncate text-sm font-semibold">{c ? `${c.caseNumber} · ${c.company}` : t('detail.title')}</h2>
          </div>
          <Button ref={closeButton} variant="ghost" size="icon" onClick={onClose} aria-label={t('common:action.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {detail.isLoading ? <LoadingState /> : null}
          {detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : null}
          {c ? (
            <div className="space-y-5">
              {canWrite ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" /> {t('common:action.edit')}
                  </Button>
                  <Button size="sm" onClick={() => onChangeStatus(c)}>
                    <ArrowRightLeft className="h-3.5 w-3.5" /> {t('actions.changeStatus')}
                  </Button>
                </div>
              ) : null}

              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase text-muted-foreground">{t('detail.progress')}</h3>
                <StatusTimeline status={c.status} />
              </section>

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t('detail.fields')}</h3>
                <Row label={t('table.caseNumber')}>
                  <span className="font-mono">{c.caseNumber}</span>
                </Row>
                <Row label={t('form.company')}>{c.company}</Row>
                <Row label={t('table.customer')}>
                  {c.customer ? (
                    <span className="inline-flex items-center gap-1.5">
                      {c.customer.name}
                      <Badge variant={c.customer.type === 'BUSINESS' ? 'info' : 'default'}>
                        {t(`customerType.${c.customer.type}`)}
                      </Badge>
                    </span>
                  ) : (
                    '–'
                  )}
                </Row>
                <Row label={t('form.unit')}>
                  {c.unit ? `${c.unit.code} — ${c.unit.brand}${c.unit.modelName ? ` ${c.unit.modelName}` : ''}` : '–'}
                </Row>
                <Row label={t('form.product')}>{c.product ? `${c.product.sku} — ${productName}` : '–'}</Row>
                <div className="border-b border-dashed py-1.5">
                  <span className="text-xs text-muted-foreground">{t('form.description')}</span>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.description}</p>
                </div>
                <Row label={t('detail.opened')}>{fmtDate(c.createdAt)}</Row>
                <Row label={t('table.submitted')}>{fmtDate(c.submittedAt)}</Row>
                <Row label={t('table.decided')}>{fmtDate(c.decidedAt)}</Row>
                {c.notes ? (
                  <div className="py-1.5">
                    <span className="text-xs text-muted-foreground">{t('common:common.notes')}</span>
                    <p className="mt-0.5 whitespace-pre-wrap text-sm">{c.notes}</p>
                  </div>
                ) : null}
              </section>

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{t('detail.money')}</h3>
                <Row label={t('table.claimed')}>
                  <span className="tabular-nums">{fmtEUR(c.claimedCents)}</span>
                </Row>
                <Row label={t('table.approved')}>
                  <span className="tabular-nums font-semibold">{fmtEUR(c.approvedCents)}</span>
                </Row>
                {difference !== null ? (
                  <Row label={t('detail.difference')}>
                    <span className={difference < 0 ? 'tabular-nums text-loss' : 'tabular-nums text-profit'}>
                      {fmtEUR(difference, { sign: true })}
                    </span>
                  </Row>
                ) : null}
              </section>

              <section>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                    {t('detail.documents')} ({c.attachments.length})
                  </h3>
                  {canWrite ? (
                    <>
                      <input
                        ref={fileInput}
                        type="file"
                        accept={ACCEPTED_FILES}
                        className="sr-only"
                        tabIndex={-1}
                        aria-label={t('detail.upload')}
                        onChange={(e) => {
                          onFile(e.target.files?.[0]);
                          e.target.value = '';
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={upload.isPending}
                        onClick={() => fileInput.current?.click()}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        {upload.isPending ? t('detail.uploading') : t('detail.upload')}
                      </Button>
                    </>
                  ) : null}
                </div>
                {canWrite ? <p className="mb-2 text-2xs text-muted-foreground">{t('detail.fileTypes')}</p> : null}
                {c.attachments.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 rounded-md border border-dashed p-4 text-center">
                    <Paperclip className="h-5 w-5 text-muted-foreground/60" aria-hidden="true" />
                    <p className="text-xs text-muted-foreground">{t('detail.noDocuments')}</p>
                  </div>
                ) : (
                  <ul className="space-y-1.5">
                    {c.attachments.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
                        {a.mimeType.startsWith('image/') ? (
                          <ImageIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        ) : (
                          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                        )}
                        <a
                          href={`/api/attachments/${a.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          title={t('detail.open', { name: a.fileName })}
                        >
                          {a.fileName}
                        </a>
                        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                          {fmtFileSize(a.sizeBytes)} · {fmtDate(a.createdAt)}
                        </span>
                        {isAdmin ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-destructive"
                            aria-label={t('detail.deleteDoc', { name: a.fileName })}
                            onClick={() => setToDelete(a)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        onClose={() => {
          if (!remove.isPending) setToDelete(null);
        }}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
        title={t('detail.deleteTitle')}
        message={t('detail.deleteMessage', { name: toDelete?.fileName ?? '' })}
        confirmLabel={t('common:action.delete')}
        busy={remove.isPending}
      />
    </div>
  );
}
