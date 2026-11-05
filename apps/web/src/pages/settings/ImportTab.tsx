import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, LoadingState, Spinner } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { fmtDateTime, type ImportBatchListRow, type ImportIssue, type ImportSummary, SectionTitle } from './shared';

const MAX_BYTES = 20 * 1024 * 1024;

export default function ImportTab() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <SectionTitle title={t('import.title')} description={t('import.description')} />
      <UploadCard />
      <BatchesCard />
    </div>
  );
}

function UploadCard() {
  const { t } = useTranslation('settings');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);

  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api.post<{ batch: { id: number; summary: ImportSummary; issues: ImportIssue[] } }>('/import/excel', fd);
    },
    onSuccess: ({ batch }) => {
      toast.success(t('import.doneOk', { count: batch.issues.length }));
      void queryClient.invalidateQueries({ queryKey: ['import'] });
      void queryClient.invalidateQueries({ queryKey: ['units'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setConfirming(false);
      setFile(null);
      navigate(`/settings/import/${batch.id}`);
    },
    onError: (err: Error) => {
      setConfirming(false);
      toast.error(err.message);
    },
  });

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.xlsx')) {
      toast.error(t('import.badType'));
      return;
    }
    if (f.size > MAX_BYTES) {
      toast.error(t('import.tooLarge'));
      return;
    }
    setFile(f);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('import.uploadTitle')}</CardTitle>
        <CardDescription>{t('import.uploadHint')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          tabIndex={-1}
          aria-label={t('import.chooseFile')}
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <div className="flex flex-col gap-3 rounded-md border border-dashed p-4 sm:flex-row sm:items-center">
          <FileSpreadsheet className="h-8 w-8 shrink-0 text-muted-foreground" aria-hidden />
          <div className="min-w-0 flex-1">
            {file ? (
              <>
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-2xs text-muted-foreground">
                  {t('import.fileSize', { size: fmtNumber(Math.max(1, Math.round(file.size / 1024))) })}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t('import.noFile')}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              {file ? t('import.changeFile') : t('import.chooseFile')}
            </Button>
            <Button onClick={() => setConfirming(true)} disabled={!file || upload.isPending}>
              <Upload className="h-4 w-4" /> {t('import.start')}
            </Button>
          </div>
        </div>
        {upload.isPending ? (
          <div role="status" aria-live="polite" className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Spinner className="h-4 w-4" />
              {t('import.running')}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
              <div className="h-full w-1/3 animate-pulse rounded bg-primary" />
            </div>
            <p className="text-2xs text-muted-foreground">{t('import.runningHint')}</p>
          </div>
        ) : null}
        <p className="text-2xs text-muted-foreground">{t('import.phonesNote')}</p>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('import.confirmTitle')}
        message={t('import.confirmMessage', { file: file?.name ?? '' })}
        confirmLabel={upload.isPending ? t('import.runningShort') : t('import.start')}
        destructive={false}
        busy={upload.isPending}
        onConfirm={() => {
          if (!file) return;
          // close the confirmation so the progress panel is visible while the server works
          setConfirming(false);
          upload.mutate(file);
        }}
      />
    </Card>
  );
}

function BatchesCard() {
  const { t } = useTranslation('settings');
  const q = useQuery({
    queryKey: ['import', 'batches'],
    queryFn: () => api.get<{ batches: ImportBatchListRow[] }>('/import/batches'),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('import.batchesTitle')}</CardTitle>
        <CardDescription>{t('import.batchesHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data?.batches.length ? (
          <EmptyState title={t('import.noBatches')} hint={t('import.noBatchesHint')} />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>{t('import.file')}</TH>
                <TH>{t('import.importedAt')}</TH>
                <TH className="text-right">{t('import.counts.units')}</TH>
                <TH className="text-right">{t('import.counts.rentals')}</TH>
                <TH className="text-right">{t('import.counts.salesEntries')}</TH>
                <TH className="text-right">{t('import.counts.expenses')}</TH>
                <TH>{t('import.issues')}</TH>
                <TH className="text-right">{t('common:common.actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {q.data.batches.map((b) => {
                const s = b.summary ?? {};
                const review = s.needsReview ?? 0;
                const n = (v: number | undefined) => (v === undefined ? '–' : fmtNumber(v));
                return (
                  <TR key={b.id}>
                    <TD className="max-w-[14rem] truncate font-medium" title={b.fileName}>
                      {b.fileName}
                    </TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(b.importedAt)}</TD>
                    <TD className="text-right tabular-nums">{n(s.units)}</TD>
                    <TD className="text-right tabular-nums">{n(s.rentals)}</TD>
                    <TD className="text-right tabular-nums">{n(s.salesEntries)}</TD>
                    <TD className="text-right tabular-nums">{n(s.expenses)}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <Badge variant={b.issueCount ? 'outline' : 'success'}>
                          {t('import.issueCount', { count: b.issueCount })}
                        </Badge>
                        {review > 0 ? (
                          <Badge variant="warning">{t('import.reviewCount', { count: review })}</Badge>
                        ) : null}
                      </div>
                    </TD>
                    <TD className="text-right">
                      <Link
                        to={`/settings/import/${b.id}`}
                        className={buttonVariants({ variant: 'outline', size: 'sm' })}
                      >
                        {t('import.viewReport')}
                      </Link>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
