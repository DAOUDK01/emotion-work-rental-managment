import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { api, downloadFile, qs } from '@/lib/api';
import { fmtDate, fmtEUR, fmtNumber } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { KpiCard } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/input';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { errMsg, modelName, todayIso, type ZReportData } from './types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** End-of-day Z-report for one business date (+ PDF download). */
export function ZReportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const [date, setDate] = useState(todayIso);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (open) setDate(todayIso());
  }, [open]);

  const report = useQuery({
    queryKey: ['pos', 'z-report', date],
    queryFn: () => api.get<ZReportData>('/pos/z-report' + qs({ date })),
    enabled: open && date !== '',
  });
  const r = report.data;
  const isEmpty = r ? r.totals.salesCount === 0 && r.refunds.count === 0 : false;

  const download = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/pos/z-report${qs({ date, format: 'pdf' })}`, `z-report-${date}.pdf`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('zreport.title')}
      wide
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('common:action.close')}
          </Button>
          <Button onClick={() => void download()} disabled={downloading || !r || isEmpty}>
            <Download className="h-4 w-4" /> {t('common:action.downloadPdf')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('common:common.date')} className="max-w-[12rem]">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {report.isLoading ? <LoadingState label={t('common:common.loading')} /> : null}
        {report.isError ? <ErrorState error={report.error} onRetry={() => void report.refetch()} /> : null}
        {r && isEmpty ? <EmptyState title={t('zreport.empty', { date: fmtDate(r.date) })} hint={t('zreport.emptyHint')} /> : null}

        {r && !isEmpty ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <KpiCard label={t('zreport.sales')} value={fmtNumber(r.totals.salesCount)} sub={fmtDate(r.date)} />
              <KpiCard label={t('zreport.gross')} value={fmtEUR(r.totals.grossCents)} />
              <KpiCard
                label={t('common:money.vat')}
                value={fmtEUR(r.totals.vatCents)}
                sub={`${t('common:money.net')} ${fmtEUR(r.totals.netCents)}`}
              />
              <KpiCard label={t('totals.discounts')} value={fmtEUR(r.totals.discountCents)} />
            </div>

            <Section title={t('zreport.byModel')}>
              {r.byModel.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('zreport.none')}</p>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('details.model')}</TH>
                      <TH className="text-right">{t('zreport.sales')}</TH>
                      <TH className="text-right">{t('zreport.gross')}</TH>
                      <TH className="text-right">{t('common:money.vat')}</TH>
                      <TH className="text-right">{t('common:money.net')}</TH>
                      <TH className="text-right">{t('totals.discounts')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {r.byModel.map((row) => (
                      <TR key={row.model.id}>
                        <TD className="font-medium">{modelName(row.model, lang)}</TD>
                        <TD className="text-right tabular-nums">{row.salesCount}</TD>
                        <TDMoney>{fmtEUR(row.grossCents)}</TDMoney>
                        <TDMoney>{fmtEUR(row.vatCents)}</TDMoney>
                        <TDMoney>{fmtEUR(row.netCents)}</TDMoney>
                        <TDMoney>{fmtEUR(row.discountCents)}</TDMoney>
                      </TR>
                    ))}
                  </TBody>
                  <TFoot>
                    <TR>
                      <TD>{t('common:common.total')}</TD>
                      <TD className="text-right tabular-nums">{r.totals.salesCount}</TD>
                      <TDMoney>{fmtEUR(r.totals.grossCents)}</TDMoney>
                      <TDMoney>{fmtEUR(r.totals.vatCents)}</TDMoney>
                      <TDMoney>{fmtEUR(r.totals.netCents)}</TDMoney>
                      <TDMoney>{fmtEUR(r.totals.discountCents)}</TDMoney>
                    </TR>
                  </TFoot>
                </Table>
              )}
            </Section>

            <div className="grid gap-4 lg:grid-cols-2">
              <Section title={t('zreport.byMethod')}>
                {r.byMethod.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('zreport.none')}</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t('common:money.paymentMethod')}</TH>
                        <TH className="text-right">{t('zreport.count')}</TH>
                        <TH className="text-right">{t('common:common.total')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {r.byMethod.map((row, i) => (
                        <TR key={row.method?.id ?? `none-${i}`}>
                          <TD>{row.method?.name ?? t('payment.noMethod')}</TD>
                          <TD className="text-right tabular-nums">{row.count}</TD>
                          <TDMoney>{fmtEUR(row.amountCents)}</TDMoney>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </Section>
              <Section title={t('zreport.byReceiver')}>
                {r.byReceiver.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('zreport.none')}</p>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t('common:money.receivedBy')}</TH>
                        <TH className="text-right">{t('zreport.count')}</TH>
                        <TH className="text-right">{t('common:common.total')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {r.byReceiver.map((row) => (
                        <TR key={row.receivedBy.id}>
                          <TD>{row.receivedBy.name}</TD>
                          <TD className="text-right tabular-nums">{row.count}</TD>
                          <TDMoney>{fmtEUR(row.amountCents)}</TDMoney>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                )}
              </Section>
            </div>

            <Section title={t('zreport.refunds')}>
              {r.refunds.count === 0 ? (
                <p className="text-xs text-muted-foreground">{t('zreport.noRefunds')}</p>
              ) : (
                <>
                  <p className="text-sm">
                    {t('zreport.refundSummary', {
                      count: r.refunds.count,
                      gross: fmtEUR(r.refunds.grossCents),
                      vat: fmtEUR(r.refunds.vatCents),
                    })}
                  </p>
                  <Table>
                    <THead>
                      <TR>
                        <TH>{t('refund.creditNote')}</TH>
                        <TH>{t('refund.receipt')}</TH>
                        <TH>{t('refund.reason')}</TH>
                        <TH>{t('refund.restockShort')}</TH>
                        <TH className="text-right">{t('common:common.total')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {r.refunds.creditNotes.map((cn) => (
                        <TR key={cn.id}>
                          <TD className="font-medium">{cn.numberFormatted}</TD>
                          <TD>{cn.saleNumber ?? '–'}</TD>
                          <TD className="max-w-[16rem] truncate" title={cn.reason}>
                            {cn.reason}
                          </TD>
                          <TD>
                            <Badge variant={cn.restocked ? 'success' : 'default'}>
                              {cn.restocked ? t('common:common.yes') : t('common:common.no')}
                            </Badge>
                          </TD>
                          <TDMoney className="text-loss">{fmtEUR(-Math.abs(cn.grossCents))}</TDMoney>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </>
              )}
            </Section>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
