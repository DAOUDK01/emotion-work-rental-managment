import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ArrowLeft, Download, Lock } from 'lucide-react';
import { downloadFile } from '@/lib/api';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, EmptyState, PageHeader } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { InvoiceActions } from './InvoiceActions';
import { InvoiceSummaryCard } from './InvoiceHeader';
import { creditNotePdfName, fmtVatRate, vatBreakdown, type InvoiceCreditNote, type InvoiceDetail } from './types';

/** Read-only invoice (SENT and later, or any invoice for read-only roles). */
export function InvoiceDetailView({ invoice, canWrite }: { invoice: InvoiceDetail; canWrite: boolean }) {
  const { t } = useTranslation('invoices');
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const breakdown = vatBreakdown(
    invoice.lines.map((l) => ({
      rateBp: l.vatRateBp,
      grossCents: l.lineGrossCents,
      vatCents: l.lineVatCents,
      netCents: l.lineNetCents,
    })),
  );

  const downloadCreditNote = async (cn: InvoiceCreditNote) => {
    setDownloadingId(cn.id);
    try {
      await downloadFile(`/invoices/credit-notes/${cn.id}/pdf`, creditNotePdfName(invoice.language, cn.numberFormatted));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:common.errorTitle'));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader
        title={t('detail.title', { number: invoice.numberFormatted })}
        description={invoice.customer.name}
        actions={
          <Link to="/invoices" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            <ArrowLeft className="h-4 w-4" /> {t('actions.backToList')}
          </Link>
        }
      />

      {invoice.status !== 'DRAFT' ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="note">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{invoice.status === 'CANCELLED' ? t('detail.cancelledHint') : t('detail.lockedHint')}</span>
        </div>
      ) : !canWrite ? (
        <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" role="note">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{t('detail.readOnlyHint')}</span>
        </div>
      ) : null}

      <InvoiceSummaryCard invoice={invoice} actions={<InvoiceActions invoice={invoice} canWrite={canWrite} />} />

      <Card>
        <CardHeader>
          <CardTitle>{t('lines.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {invoice.lines.length === 0 ? (
            <EmptyState title={t('lines.emptyTitle')} />
          ) : (
            <Table className="min-w-[640px]">
              <THead>
                <TR>
                  <TH>{t('lines.description')}</TH>
                  <TH className="text-right">{t('lines.qty')}</TH>
                  <TH className="text-right">{t('lines.unitPrice')}</TH>
                  <TH className="text-right">{t('lines.discount')}</TH>
                  <TH className="text-right">{t('lines.vat')}</TH>
                  <TH className="text-right">{t('lines.lineTotal')}</TH>
                </TR>
              </THead>
              <TBody>
                {invoice.lines.map((l) => (
                  <TR key={l.id}>
                    <TD>
                      <div className="font-medium">{l.description}</div>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {l.product ? <Badge variant="outline">{l.product.sku}</Badge> : null}
                        {l.isLabour ? <Badge variant="info">{t('lines.labour')}</Badge> : null}
                        {l.discountReason ? (
                          <span className="text-2xs text-muted-foreground">{l.discountReason}</span>
                        ) : null}
                      </div>
                    </TD>
                    <TD className="text-right tabular-nums">{l.qty}</TD>
                    <TDMoney>{fmtEUR(l.unitPriceCents)}</TDMoney>
                    <TDMoney>{l.discountCents ? fmtEUR(l.discountCents) : '–'}</TDMoney>
                    <TD className="text-right tabular-nums">{fmtVatRate(l.vatRateBp)}</TD>
                    <TDMoney className="font-medium">{fmtEUR(l.lineGrossCents)}</TDMoney>
                  </TR>
                ))}
              </TBody>
              <TFoot>
                <TR>
                  <TD colSpan={5} className="text-right font-normal text-muted-foreground">
                    {t('totals.net')}
                  </TD>
                  <TDMoney>{fmtEUR(invoice.totalNetCents)}</TDMoney>
                </TR>
                {breakdown.map((row) => (
                  <TR key={row.rateBp}>
                    <TD colSpan={5} className="text-right font-normal text-muted-foreground">
                      {t('totals.vatAt', { rate: fmtVatRate(row.rateBp), base: fmtEUR(row.netCents) })}
                    </TD>
                    <TDMoney className="font-normal">{fmtEUR(row.vatCents)}</TDMoney>
                  </TR>
                ))}
                <TR>
                  <TD colSpan={5} className="text-right">
                    {t('totals.gross')}
                  </TD>
                  <TDMoney className="text-base">{fmtEUR(invoice.totalGrossCents)}</TDMoney>
                </TR>
              </TFoot>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('detail.payments')}</CardTitle>
            <CardDescription>
              {t('detail.paymentsSummary', { paid: fmtEUR(invoice.paidCents), count: invoice.payments.length })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invoice.payments.length === 0 ? (
              <EmptyState
                title={t('detail.noPayments')}
                hint={invoice.status === 'DRAFT' ? t('detail.noPaymentsDraft') : t('detail.noPaymentsHint')}
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('common:common.date')}</TH>
                    <TH>{t('common:money.receivedBy')}</TH>
                    <TH>{t('common:money.paymentMethod')}</TH>
                    <TH className="text-right">{t('detail.amount')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoice.payments.map((p) => (
                    <TR key={p.id}>
                      <TD className="whitespace-nowrap">{fmtDate(p.date)}</TD>
                      <TD>
                        {p.receivedBy.name}
                        {p.reference ? <div className="text-2xs text-muted-foreground">{p.reference}</div> : null}
                      </TD>
                      <TD>{p.method?.name ?? '–'}</TD>
                      <TDMoney className={p.amountCents < 0 ? 'text-loss' : undefined}>{fmtEUR(p.amountCents)}</TDMoney>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('detail.creditNotes')}</CardTitle>
            <CardDescription>{t('detail.creditNotesHint')}</CardDescription>
          </CardHeader>
          <CardContent>
            {invoice.creditNotes.length === 0 ? (
              <EmptyState title={t('detail.noCreditNotes')} />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('detail.number')}</TH>
                    <TH>{t('credit.reason')}</TH>
                    <TH className="text-right">{t('detail.amount')}</TH>
                    <TH>
                      <span className="sr-only">{t('common:common.actions')}</span>
                    </TH>
                  </TR>
                </THead>
                <TBody>
                  {invoice.creditNotes.map((cn) => (
                    <TR key={cn.id}>
                      <TD className="whitespace-nowrap">
                        <div className="font-medium tabular-nums">{cn.numberFormatted}</div>
                        <div className="text-2xs text-muted-foreground">{fmtDate(cn.issueDate)}</div>
                      </TD>
                      <TD>
                        <div className="text-sm">{cn.reason}</div>
                        {cn.restocked ? <Badge variant="info">{t('detail.restocked')}</Badge> : null}
                      </TD>
                      <TDMoney className="text-loss">{fmtEUR(-cn.totalGrossCents)}</TDMoney>
                      <TD className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={downloadingId === cn.id}
                          onClick={() => void downloadCreditNote(cn)}
                          aria-label={t('detail.creditNotePdf', { number: cn.numberFormatted })}
                        >
                          <Download className="h-3.5 w-3.5" /> {t('detail.pdf')}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {invoice.notes || invoice.rental ? (
        <Card>
          <CardContent className="space-y-2 p-4 text-sm">
            {invoice.rental ? (
              <p className="text-muted-foreground">
                {t('detail.fromRental', {
                  id: invoice.rental.id,
                  period: invoice.rental.periodText ?? fmtDate(invoice.rental.startDate),
                })}
              </p>
            ) : null}
            {invoice.notes ? (
              <div>
                <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('common:common.notes')}
                </div>
                <p className="whitespace-pre-wrap">{invoice.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
