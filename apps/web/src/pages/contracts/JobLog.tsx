import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Lock, Pencil, Plus, Trash2, X } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Badge, EmptyState, ErrorState, LoadingState, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { InvoiceMonthDialog } from './InvoiceMonthDialog';
import { JobFormDialog } from './JobFormDialog';
import {
  errorMessage,
  fmtHours,
  type Contract,
  type ContractDetail,
  type ContractJob,
  type JobListResponse,
} from './types';

const PAGE_SIZE = 50;
type InvoicedFilter = '' | 'false' | 'true';

/** The selected contract's job log: one row per repaired vehicle, monthly billing action. */
export function JobLog({
  contract,
  canWrite,
  onClose,
  periodText,
}: {
  contract: Contract;
  canWrite: boolean;
  onClose: () => void;
  periodText: string;
}) {
  const { t, i18n } = useTranslation('contracts');
  const queryClient = useQueryClient();
  const [invoiced, setInvoiced] = useState<InvoicedFilter>('');
  const [page, setPage] = useState(1);
  const [jobFormOpen, setJobFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ContractJob | null>(null);
  const [toDelete, setToDelete] = useState<ContractJob | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);

  // the parent remounts this component per contract (key), so only the filter resets paging
  useEffect(() => setPage(1), [invoiced]);

  const detail = useQuery({
    queryKey: ['contracts', contract.id],
    queryFn: () => api.get<{ contract: ContractDetail }>(`/contracts/${contract.id}`),
  });

  const jobsQs = useMemo(() => qs({ invoiced: invoiced || undefined, page, pageSize: PAGE_SIZE }), [invoiced, page]);
  const jobs = useQuery({
    queryKey: ['contracts', contract.id, 'jobs', jobsQs],
    queryFn: () => api.get<JobListResponse>(`/contracts/${contract.id}/jobs${jobsQs}`),
    placeholderData: keepPreviousData,
  });

  const remove = useMutation({
    mutationFn: (job: ContractJob) => api.post<{ ok: true }>(`/contracts/${contract.id}/jobs/${job.id}/void`, {}),
    onSuccess: () => {
      toast.success(t('deleteJob.deleted'));
      setToDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['contracts'] });
    },
    onError: (err) => {
      setToDelete(null);
      if (err instanceof ApiError && err.code === 'ALREADY_INVOICED') {
        toast.error(t('deleteJob.alreadyInvoiced'));
        void queryClient.invalidateQueries({ queryKey: ['contracts'] });
        return;
      }
      toast.error(errorMessage(err, t('common:common.errorTitle')));
    },
  });

  const openAdd = () => {
    setEditingJob(null);
    setJobFormOpen(true);
  };

  const rows = jobs.data?.jobs ?? [];
  const total = jobs.data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageSum = rows.reduce((s, j) => s + j.amountCents, 0);
  const d = detail.data?.contract;

  return (
    <Card id="contract-job-log" aria-labelledby="contract-job-log-title">
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0">
          <CardTitle id="contract-job-log-title" className="text-base">
            {t('jobs.title', { name: contract.name })}
          </CardTitle>
          <CardDescription>
            {contract.customer.name} · {periodText}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canWrite ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setInvoiceOpen(true)}>
                <FileText className="h-3.5 w-3.5" /> {t('invoiceMonth.action')}
              </Button>
              <Button size="sm" onClick={openAdd}>
                <Plus className="h-3.5 w-3.5" /> {t('jobs.add')}
              </Button>
            </>
          ) : null}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} aria-label={t('jobs.close')}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* uninvoiced summary from the contract detail */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-xs">
            {detail.isLoading ? (
              <span className="text-muted-foreground">{t('common:common.loading')}</span>
            ) : detail.isError ? (
              <span className="text-destructive">{errorMessage(detail.error, t('common:common.errorTitle'))}</span>
            ) : d ? (
              <span className={d.uninvoicedJobCount > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                {d.uninvoicedJobCount > 0
                  ? t('jobs.uninvoicedSummary', { count: d.uninvoicedJobCount, amount: fmtEUR(d.uninvoicedCents) })
                  : t('jobs.allInvoiced')}
              </span>
            ) : null}
          </div>
          <Segmented
            size="sm"
            value={invoiced}
            onChange={setInvoiced}
            options={[
              { value: '' as const, label: t('jobs.filterAll') },
              { value: 'false' as const, label: t('jobs.filterUninvoiced') },
              { value: 'true' as const, label: t('jobs.filterInvoiced') },
            ]}
          />
        </div>

        {jobs.isLoading ? (
          <LoadingState />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
        ) : rows.length === 0 ? (
          invoiced ? (
            <EmptyState title={t('jobs.emptyFiltered')} hint={t('jobs.emptyFilteredHint')} />
          ) : (
            <EmptyState
              title={t('jobs.empty')}
              hint={t('jobs.emptyHint')}
              action={
                canWrite ? (
                  <Button size="sm" onClick={openAdd}>
                    <Plus className="h-3.5 w-3.5" /> {t('jobs.add')}
                  </Button>
                ) : null
              }
            />
          )
        ) : (
          <>
            <Table aria-busy={jobs.isFetching}>
              <THead>
                <TR>
                  <TH>{t('jobs.date')}</TH>
                  <TH>{t('jobs.vehicleRef')}</TH>
                  <TH>{t('jobs.description')}</TH>
                  <TH className="text-right">{t('jobs.hours')}</TH>
                  <TH className="text-right">{t('jobs.amount')}</TH>
                  <TH>{t('jobs.invoiced')}</TH>
                  {canWrite ? (
                    <TH className="text-right">
                      <span className="sr-only">{t('common:common.actions')}</span>
                    </TH>
                  ) : null}
                </TR>
              </THead>
              <TBody>
                {rows.map((job) => (
                  <TR key={job.id}>
                    <TD className="whitespace-nowrap tabular-nums">{fmtDate(job.date)}</TD>
                    <TD className="whitespace-nowrap font-mono text-xs font-medium">{job.vehicleRef}</TD>
                    <TD className="min-w-[12rem] text-xs">{job.description}</TD>
                    <TD className="text-right tabular-nums">{fmtHours(job.hours, i18n.language)}</TD>
                    <TDMoney className="whitespace-nowrap font-medium">{fmtEUR(job.amountCents)}</TDMoney>
                    <TD className="whitespace-nowrap">
                      {job.invoiceId !== null ? (
                        <Link
                          to={`/invoices/${job.invoiceId}`}
                          className="inline-flex items-center gap-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={t('jobs.openInvoiceFor', { vehicleRef: job.vehicleRef })}
                          title={job.invoicedAt ? t('jobs.invoicedOn', { date: fmtDate(job.invoicedAt) }) : undefined}
                        >
                          <Badge variant="info">
                            {t('jobs.invoicedBadge')} <ExternalLink className="h-3 w-3" aria-hidden="true" />
                          </Badge>
                        </Link>
                      ) : (
                        <Badge variant="warning">{t('jobs.notInvoiced')}</Badge>
                      )}
                    </TD>
                    {canWrite ? (
                      <TD className="text-right">
                        {job.invoiceId === null ? (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              aria-label={t('jobs.editJob', { vehicleRef: job.vehicleRef })}
                              title={t('jobs.editJob', { vehicleRef: job.vehicleRef })}
                              onClick={() => {
                                setEditingJob(job);
                                setJobFormOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive"
                              aria-label={t('jobs.deleteJob', { vehicleRef: job.vehicleRef })}
                              title={t('jobs.deleteJob', { vehicleRef: job.vehicleRef })}
                              onClick={() => setToDelete(job)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ) : (
                          <span
                            className="inline-flex h-8 w-8 items-center justify-center text-muted-foreground"
                            title={t('jobs.lockedHint')}
                          >
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            <span className="sr-only">{t('jobs.lockedHint')}</span>
                          </span>
                        )}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD colSpan={4}>
                    {total > PAGE_SIZE ? t('jobs.pageTotal') : t('common:common.total')}
                  </TD>
                  <TDMoney>{fmtEUR(pageSum)}</TDMoney>
                  <TD colSpan={canWrite ? 2 : 1} />
                </TR>
              </TFoot>
            </Table>
            {total > PAGE_SIZE ? (
              <nav className="flex items-center justify-between gap-2 text-xs" aria-label={t('pagination.jobsLabel')}>
                <span className="text-muted-foreground">
                  {t('pagination.showing', {
                    from: (page - 1) * PAGE_SIZE + 1,
                    to: Math.min(page * PAGE_SIZE, total),
                    total,
                  })}
                </span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" /> {t('pagination.prev')}
                  </Button>
                  <span className="tabular-nums">
                    {t('common:common.page')} {page} {t('common:common.of')} {lastPage}
                  </span>
                  <Button variant="outline" size="sm" disabled={page >= lastPage} onClick={() => setPage((p) => p + 1)}>
                    {t('pagination.next')} <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </nav>
            ) : null}
          </>
        )}
      </CardContent>

      {canWrite ? (
        <>
          <JobFormDialog
            open={jobFormOpen}
            contract={contract}
            job={editingJob}
            onClose={() => setJobFormOpen(false)}
          />
          <InvoiceMonthDialog open={invoiceOpen} contract={contract} onClose={() => setInvoiceOpen(false)} />
          <ConfirmDialog
            open={toDelete !== null}
            onClose={() => {
              if (!remove.isPending) setToDelete(null);
            }}
            onConfirm={() => {
              if (toDelete) remove.mutate(toDelete);
            }}
            title={t('deleteJob.title')}
            message={t('deleteJob.message', {
              vehicleRef: toDelete?.vehicleRef ?? '',
              date: fmtDate(toDelete?.date),
              amount: fmtEUR(toDelete?.amountCents),
            })}
            confirmLabel={t('common:action.delete')}
            busy={remove.isPending}
          />
        </>
      ) : null}
    </Card>
  );
}
