import { useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCcw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox, Field, Input } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { type AllSettings, fmtDateTime, SectionTitle, useSaveSettings, WithSettings } from './shared';

type SyncStatus = 'RUNNING' | 'OK' | 'ERROR';

interface SyncLogRow {
  id: number;
  target: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncStatus;
  rowsSynced: number | null;
  error: string | null;
}

interface SheetsStatus {
  configured: boolean;
  configProblem: string | null;
  lastOk: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  logs: SyncLogRow[];
}

export default function SheetsTab() {
  const { t } = useTranslation('settings');
  return (
    <div className="space-y-4">
      <SectionTitle title={t('sheets.title')} description={t('sheets.description')} />
      <WithSettings>{(s) => <SheetsConfigCard settings={s} />}</WithSettings>
      <SheetsStatusCard />
    </div>
  );
}

interface SheetsForm {
  enabled: boolean;
  sheetId: string;
}

/** Accept either the bare ID or a pasted docs.google.com URL. */
function extractSheetId(v: string): string {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(v);
  return (m ? m[1] : v).trim();
}

function SheetsConfigCard({ settings }: { settings: AllSettings }) {
  const { t } = useTranslation('settings');
  const save = useSaveSettings();
  const queryClient = useQueryClient();
  const gs = settings.googleSheets ?? {};

  const schema = useMemo(
    () =>
      z
        .object({ enabled: z.boolean(), sheetId: z.string().trim() })
        .superRefine((v, ctx) => {
          const id = extractSheetId(v.sheetId);
          if (v.enabled && id === '') {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheetId'], message: t('sheets.idRequired') });
          } else if (id !== '' && !/^[a-zA-Z0-9_-]{20,}$/.test(id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sheetId'], message: t('sheets.idInvalid') });
          }
        }),
    [t],
  );

  const defaults: SheetsForm = { enabled: gs.enabled ?? false, sheetId: gs.sheetId ?? '' };
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, isDirty },
  } = useForm<SheetsForm>({ resolver: zodResolver(schema), defaultValues: defaults });

  const onSubmit = (v: SheetsForm) => {
    const value = { ...gs, enabled: v.enabled, sheetId: extractSheetId(v.sheetId) };
    save.mutate([{ key: 'googleSheets', value }], {
      onSuccess: () => {
        reset({ enabled: value.enabled, sheetId: value.sheetId });
        void queryClient.invalidateQueries({ queryKey: ['sheets', 'status'] });
      },
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('sheets.configTitle')}</CardTitle>
        <CardDescription>{t('sheets.configHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-3" noValidate>
          <Controller
            control={control}
            name="enabled"
            render={({ field }) => (
              <Checkbox
                label={t('sheets.enabled')}
                checked={field.value}
                onChange={(e) => field.onChange(e.target.checked)}
              />
            )}
          />
          <Field label={t('sheets.sheetId')} error={errors.sheetId?.message} hint={t('sheets.sheetIdHint')}>
            <Input className="font-mono text-xs" placeholder="1AbC…xyz" {...register('sheetId')} />
          </Field>
          <p className="text-2xs text-muted-foreground">{t('sheets.serviceAccountHint')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => reset(defaults)} disabled={!isDirty || save.isPending}>
              {t('form.discard')}
            </Button>
            <Button type="submit" disabled={!isDirty || save.isPending}>
              {t('common:action.save')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SheetsStatusCard() {
  const { t } = useTranslation('settings');
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ['sheets', 'status'],
    queryFn: () => api.get<SheetsStatus>('/sheets/status'),
  });

  const sync = useMutation({
    mutationFn: () => api.post<{ log: SyncLogRow }>('/sheets/sync'),
    onSuccess: ({ log }) => {
      if (log.status === 'ERROR') toast.error(log.error ?? t('sheets.syncFailed'));
      else toast.success(t('sheets.syncOk', { rows: fmtNumber(log.rowsSynced ?? 0) }));
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === 'NOT_CONFIGURED') {
        toast.error(t('sheets.notConfigured'), { description: err.message });
      } else if (err instanceof ApiError && err.code === 'SYNC_IN_PROGRESS') {
        toast.error(t('sheets.inProgress'));
      } else {
        toast.error(err.message);
      }
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['sheets', 'status'] }),
  });

  const statusBadge = (s: SyncStatus) =>
    s === 'OK' ? (
      <Badge variant="success">{t('sheets.status.OK')}</Badge>
    ) : s === 'ERROR' ? (
      <Badge variant="danger">{t('sheets.status.ERROR')}</Badge>
    ) : (
      <Badge variant="info">{t('sheets.status.RUNNING')}</Badge>
    );

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{t('sheets.statusTitle')}</CardTitle>
          <CardDescription>{t('sheets.statusHint')}</CardDescription>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void q.refetch()} disabled={q.isFetching}>
            {t('common:action.refresh')}
          </Button>
          <Button size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCcw className={sync.isPending ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            {sync.isPending ? t('sheets.syncing') : t('sheets.syncNow')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {q.isLoading ? (
          <LoadingState />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        ) : q.data ? (
          <>
            {!q.data.configured ? (
              <div
                role="alert"
                className="rounded-md border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
              >
                <p className="font-medium">{t('sheets.notConfigured')}</p>
                {q.data.configProblem ? <p className="mt-0.5">{q.data.configProblem}</p> : null}
              </div>
            ) : null}
            <dl className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{t('sheets.configured')}</dt>
                <dd className="mt-1">
                  {q.data.configured ? (
                    <Badge variant="success">{t('common:common.yes')}</Badge>
                  ) : (
                    <Badge variant="warning">{t('common:common.no')}</Badge>
                  )}
                </dd>
              </div>
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{t('sheets.lastOk')}</dt>
                <dd className="mt-1 text-sm font-medium">{q.data.lastOk ? fmtDateTime(q.data.lastOk) : t('sheets.never')}</dd>
              </div>
              <div className="rounded-md border p-3">
                <dt className="text-xs text-muted-foreground">{t('sheets.lastError')}</dt>
                <dd className="mt-1 text-sm">
                  {q.data.lastError ? (
                    <>
                      <span className="block text-2xs text-muted-foreground">{fmtDateTime(q.data.lastErrorAt)}</span>
                      <span className="block break-words text-xs text-loss">{q.data.lastError}</span>
                    </>
                  ) : (
                    <span className="font-medium">{t('sheets.noErrors')}</span>
                  )}
                </dd>
              </div>
            </dl>
            {q.data.logs.length === 0 ? (
              <EmptyState title={t('sheets.noLogs')} hint={t('sheets.noLogsHint')} />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('sheets.started')}</TH>
                    <TH>{t('sheets.finished')}</TH>
                    <TH>{t('common:common.status')}</TH>
                    <TH className="text-right">{t('sheets.rows')}</TH>
                    <TH>{t('sheets.error')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {q.data.logs.map((l) => (
                    <TR key={l.id}>
                      <TD className="whitespace-nowrap">{fmtDateTime(l.startedAt)}</TD>
                      <TD className="whitespace-nowrap">{fmtDateTime(l.finishedAt)}</TD>
                      <TD>{statusBadge(l.status)}</TD>
                      <TD className="text-right tabular-nums">{l.rowsSynced === null ? '–' : fmtNumber(l.rowsSynced)}</TD>
                      <TD className="max-w-[20rem] truncate text-xs text-muted-foreground" title={l.error ?? undefined}>
                        {l.error ?? '–'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
