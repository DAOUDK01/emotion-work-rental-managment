import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isValidBusinessId } from '@emotionfix/shared';
import {
  Archive,
  ArchiveRestore,
  Building2,
  ChevronDown,
  Eraser,
  FileJson,
  Pencil,
  ShieldAlert,
  User,
  X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, ErrorState, LoadingState } from '@/components/ui/misc';
import { cn } from '@/components/ui/utils';
import CustomerEraseDialog from './CustomerEraseDialog';
import CustomerHistoryTabs from './CustomerHistoryTabs';
import { hasPhoneField, type Customer, type CustomerDetailResponse } from './types';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed py-1.5 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right text-sm">{children}</span>
    </div>
  );
}

/**
 * GDPR export. The endpoint answers `application/json`, which the shared API
 * client parses into an object — re-serialise it into a Blob for the download.
 */
async function exportCustomerJson(id: number): Promise<void> {
  const data = await api.get<unknown>(`/gdpr/customers/${id}/export`);
  const blob =
    data instanceof Blob ? data : new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `customer-${id}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Right-side customer panel: profile, outstanding balance, history tabs, archive + GDPR actions. */
export default function CustomerDetailDrawer({
  customerId,
  onClose,
  onEdit,
}: {
  customerId: number | null;
  onClose: () => void;
  onEdit: (customer: Customer) => void;
}) {
  const { t } = useTranslation('customers');
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const closeButton = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [eraseOpen, setEraseOpen] = useState(false);

  const open = customerId !== null;
  const canWrite = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const isAdmin = user?.role === 'ADMIN';

  useEffect(() => {
    if (open) closeButton.current?.focus();
    else {
      setMenuOpen(false);
      setArchiveOpen(false);
      setEraseOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // A dialog stacked on top of the drawer (edit / archive / erase) closes first.
      if (document.querySelectorAll('[role="dialog"]').length > 1) return;
      if (menuOpen) {
        setMenuOpen(false);
        menuButton.current?.focus();
        return;
      }
      onClose();
    };
    // Capture phase: runs before the stacked dialog's own Escape handler removes it.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose, menuOpen]);

  // GDPR menu: close on outside click, focus the first item when it opens.
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const detail = useQuery({
    queryKey: ['customers', customerId],
    queryFn: () => api.get<CustomerDetailResponse>(`/customers/${customerId}`),
    enabled: open,
  });

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      api.post<{ customer: Customer }>(`/customers/${customerId}/archive`, { archived }),
    onSuccess: (_res, archived) => {
      toast.success(archived ? t('archive.archivedOk') : t('archive.unarchivedOk'));
      setArchiveOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      void queryClient.invalidateQueries({ queryKey: ['lookups'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const exportData = useMutation({
    mutationFn: (id: number) => exportCustomerJson(id),
    onSuccess: () => toast.success(t('gdpr.exportedOk')),
    onError: (err: Error) => toast.error(err.message),
  });

  if (!open) return null;
  const d = detail.data;
  const c = d?.customer;
  const showPhone = c ? hasPhoneField(c) : false;
  const businessIdOk = c?.type === 'BUSINESS' && c.businessId ? isValidBusinessId(c.businessId) : null;
  const addressLine = c ? [c.postalCode, c.city].filter(Boolean).join(' ') : '';

  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const idx = items.findIndex((el) => el === document.activeElement);
    const next = e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={c ? c.name : t('detail.title')}
    >
      <div className="flex h-full w-full max-w-2xl flex-col border-l bg-background shadow-xl">
        <div className="flex items-center justify-between gap-2 border-b bg-card px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            {c?.type === 'BUSINESS' ? (
              <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <User className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <h2 className="truncate text-sm font-semibold">{c ? c.name : t('detail.title')}</h2>
            {c?.archived ? <Badge variant="default">{t('detail.archived')}</Badge> : null}
          </div>
          <Button ref={closeButton} variant="ghost" size="icon" onClick={onClose} aria-label={t('common:action.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {detail.isLoading ? <LoadingState /> : null}
          {detail.isError ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : null}
          {d && c ? (
            <div className="space-y-4">
              {/* actions */}
              {canWrite ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => onEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" /> {t('common:action.edit')}
                  </Button>
                  {c.archived ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={archive.isPending}
                      onClick={() => archive.mutate(false)}
                    >
                      <ArchiveRestore className="h-3.5 w-3.5" /> {t('archive.unarchive')}
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setArchiveOpen(true)}>
                      <Archive className="h-3.5 w-3.5" /> {t('archive.archive')}
                    </Button>
                  )}
                  {isAdmin ? (
                    <div className="relative" ref={menuRef}>
                      <Button
                        ref={menuButton}
                        size="sm"
                        variant="outline"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setMenuOpen((v) => !v)}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" /> {t('gdpr.menu')}
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      {menuOpen ? (
                        <div
                          role="menu"
                          aria-label={t('gdpr.menu')}
                          onKeyDown={onMenuKeyDown}
                          className="absolute left-0 z-10 mt-1 w-60 rounded-md border bg-card p-1 shadow-lg sm:left-auto sm:right-0"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            disabled={exportData.isPending}
                            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-50"
                            onClick={() => {
                              setMenuOpen(false);
                              exportData.mutate(c.id);
                            }}
                          >
                            <FileJson className="h-4 w-4 text-muted-foreground" /> {t('gdpr.export')}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-destructive hover:bg-destructive/10 focus-visible:bg-destructive/10 focus-visible:outline-none"
                            onClick={() => {
                              setMenuOpen(false);
                              setEraseOpen(true);
                            }}
                          >
                            <Eraser className="h-4 w-4" /> {t('gdpr.erase')}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                {/* profile */}
                <Card className="sm:col-span-2">
                  <CardHeader>
                    <CardTitle>{t('detail.profile')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Row label={t('form.type')}>
                      <Badge variant={c.type === 'BUSINESS' ? 'navy' : 'default'}>{t(`type.${c.type}`)}</Badge>
                    </Row>
                    {c.type === 'BUSINESS' || c.businessId ? (
                      <Row label={t('form.businessId')}>
                        {c.businessId ?? '–'}
                        {businessIdOk === false ? (
                          <Badge variant="warning" className="ml-1.5" title={t('form.businessIdInvalid')}>
                            {t('detail.checkDigit')}
                          </Badge>
                        ) : null}
                      </Row>
                    ) : null}
                    <Row label={t('form.email')}>
                      {c.email ? (
                        <a className="text-primary underline-offset-2 hover:underline" href={`mailto:${c.email}`}>
                          {c.email}
                        </a>
                      ) : (
                        '–'
                      )}
                    </Row>
                    {showPhone ? (
                      <Row label={`${t('form.phone')} ${t('form.adminsOnly')}`}>
                        {c.phone ? (
                          <a className="text-primary underline-offset-2 hover:underline" href={`tel:${c.phone}`}>
                            {c.phone}
                          </a>
                        ) : (
                          '–'
                        )}
                      </Row>
                    ) : null}
                    <Row label={t('form.address')}>
                      {c.address || addressLine ? (
                        <>
                          {c.address ? <span className="block">{c.address}</span> : null}
                          {addressLine ? <span className="block">{addressLine}</span> : null}
                          <span className="block text-xs text-muted-foreground">{c.country}</span>
                        </>
                      ) : (
                        '–'
                      )}
                    </Row>
                    <Row label={t('form.language')}>{t(`language.${c.language}`)}</Row>
                    <Row label={t('detail.customerSince')}>{fmtDate(c.createdAt)}</Row>
                    {c.notes ? (
                      <Row label={t('common:common.notes')}>
                        <span className="whitespace-pre-line">{c.notes}</span>
                      </Row>
                    ) : null}
                  </CardContent>
                </Card>

                {/* outstanding */}
                <Card className="h-fit">
                  <CardHeader>
                    <CardTitle>{t('detail.outstanding')}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div
                      className={cn(
                        'text-2xl font-bold tabular-nums tracking-tight',
                        d.outstandingCents > 0 ? 'text-loss' : 'text-profit',
                      )}
                    >
                      {fmtEUR(d.outstandingCents)}
                    </div>
                    <p className="mt-1 text-2xs text-muted-foreground">
                      {d.outstandingCents > 0 ? t('detail.outstandingHint') : t('detail.allSettled')}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <CustomerHistoryTabs detail={d} />
            </div>
          ) : null}
        </div>
      </div>

      {c ? (
        <>
          <ConfirmDialog
            open={archiveOpen}
            onClose={() => setArchiveOpen(false)}
            onConfirm={() => archive.mutate(true)}
            title={t('archive.title', { name: c.name })}
            message={t('archive.message')}
            confirmLabel={t('archive.archive')}
            destructive={false}
            busy={archive.isPending}
          />
          {isAdmin ? <CustomerEraseDialog open={eraseOpen} onClose={() => setEraseOpen(false)} customer={c} /> : null}
        </>
      ) : null}
    </div>
  );
}
