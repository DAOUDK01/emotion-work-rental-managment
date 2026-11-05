import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Badge, Segmented } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TH, THead, TR } from '@/components/ui/table';
import { invoiceBadge, paymentBadge, type CustomerDetailResponse, type CustomerEntry } from './types';

type Tab = 'rentals' | 'invoices' | 'entries';

function EmptyTab({ text }: { text: string }) {
  return <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{text}</p>;
}

/** Rentals / Invoices / Entries (last 20 each) from GET /customers/:id. */
export default function CustomerHistoryTabs({ detail }: { detail: CustomerDetailResponse }) {
  const { t, i18n } = useTranslation('customers');
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('rentals');
  const modelName = (e: CustomerEntry) => (i18n.language === 'fi' ? e.model.nameFi : e.model.nameEn);

  return (
    <section className="space-y-2">
      <Segmented
        size="sm"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'rentals' as const, label: `${t('tabs.rentals')} (${detail.rentals.length})` },
          { value: 'invoices' as const, label: `${t('tabs.invoices')} (${detail.invoices.length})` },
          { value: 'entries' as const, label: `${t('tabs.entries')} (${detail.entries.length})` },
        ]}
      />
      <p className="text-2xs text-muted-foreground">{t('tabs.lastTwenty')}</p>

      {tab === 'rentals' ? (
        detail.rentals.length === 0 ? (
          <EmptyTab text={t('tabs.noRentals')} />
        ) : (
          <>
            <Table className="text-xs">
              <THead>
                <TR>
                  <TH>{t('rentals.start')}</TH>
                  <TH>{t('rentals.unit')}</TH>
                  <TH>{t('rentals.period')}</TH>
                  <TH className="text-right">{t('rentals.amount')}</TH>
                  <TH>{t('common:common.status')}</TH>
                </TR>
              </THead>
              <TBody>
                {detail.rentals.map((r) => (
                  <TR key={r.id} className={r.status === 'VOID' ? 'opacity-60' : undefined}>
                    <TD className="whitespace-nowrap tabular-nums">{fmtDate(r.startDate)}</TD>
                    <TD className="whitespace-nowrap">
                      <span className="font-medium">{r.unit.code}</span>
                      <span className="block text-2xs text-muted-foreground">{r.unit.brand}</span>
                    </TD>
                    <TD>
                      {r.periodText ?? (r.endDate ? `${fmtDate(r.startDate)} – ${fmtDate(r.endDate)}` : fmtDate(r.startDate))}
                      {r.recurring ? (
                        <Badge variant="outline" className="ml-1">
                          {t('rentals.recurring')}
                        </Badge>
                      ) : null}
                    </TD>
                    <TDMoney className="whitespace-nowrap">{fmtEUR(r.amountCents)}</TDMoney>
                    <TD>
                      {r.status === 'VOID' ? (
                        <Badge variant="danger">{t('common:status.VOID')}</Badge>
                      ) : r.entry ? (
                        <Badge variant={paymentBadge[r.entry.paymentStatus]}>
                          {t(`common:status.${r.entry.paymentStatus}`)}
                        </Badge>
                      ) : (
                        '–'
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <Link
              to="/rentals"
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t('rentals.openAll')} <ArrowRight className="h-3 w-3" />
            </Link>
          </>
        )
      ) : null}

      {tab === 'invoices' ? (
        detail.invoices.length === 0 ? (
          <EmptyTab text={t('tabs.noInvoices')} />
        ) : (
          <Table className="text-xs">
            <THead>
              <TR>
                <TH>{t('invoices.number')}</TH>
                <TH>{t('invoices.issued')}</TH>
                <TH>{t('invoices.due')}</TH>
                <TH className="text-right">{t('invoices.total')}</TH>
                <TH className="text-right">{t('invoices.paid')}</TH>
                <TH>{t('common:common.status')}</TH>
              </TR>
            </THead>
            <TBody>
              {detail.invoices.map((inv) => (
                <TR
                  key={inv.id}
                  tabIndex={0}
                  className="cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none"
                  onClick={() => navigate(`/invoices/${inv.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      navigate(`/invoices/${inv.id}`);
                    }
                  }}
                  aria-label={t('invoices.open', { number: inv.numberFormatted })}
                >
                  <TD className="whitespace-nowrap font-medium">
                    <Link
                      to={`/invoices/${inv.id}`}
                      tabIndex={-1}
                      className="text-primary underline-offset-2 hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {inv.numberFormatted}
                    </Link>
                  </TD>
                  <TD className="whitespace-nowrap tabular-nums">{fmtDate(inv.issueDate)}</TD>
                  <TD className="whitespace-nowrap tabular-nums">{fmtDate(inv.dueDate)}</TD>
                  <TDMoney className="whitespace-nowrap">{fmtEUR(inv.totalGrossCents)}</TDMoney>
                  <TDMoney className="whitespace-nowrap">{fmtEUR(inv.paidCents)}</TDMoney>
                  <TD>
                    <Badge variant={invoiceBadge(inv)}>
                      {inv.overdue ? t('invoiceStatus.OVERDUE') : t(`invoiceStatus.${inv.status}`)}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )
      ) : null}

      {tab === 'entries' ? (
        detail.entries.length === 0 ? (
          <EmptyTab text={t('tabs.noEntries')} />
        ) : (
          <Table className="text-xs">
            <THead>
              <TR>
                <TH>{t('common:common.date')}</TH>
                <TH>{t('entries.model')}</TH>
                <TH>{t('entries.description')}</TH>
                <TH className="text-right">{t('common:money.gross')}</TH>
                <TH>{t('common:common.status')}</TH>
              </TR>
            </THead>
            <TBody>
              {detail.entries.map((e) => (
                <TR key={e.id} className={e.status === 'VOID' ? 'opacity-60' : undefined}>
                  <TD className="whitespace-nowrap tabular-nums">{fmtDate(e.entryDate)}</TD>
                  <TD className="whitespace-nowrap">{modelName(e)}</TD>
                  <TD className="max-w-[12rem]">
                    <span className="block truncate" title={e.description ?? undefined}>
                      {e.description ?? '–'}
                    </span>
                    {e.unit ? <span className="block text-2xs text-muted-foreground">{e.unit.code}</span> : null}
                  </TD>
                  <TDMoney className="whitespace-nowrap">
                    {fmtEUR(e.grossCents)}
                    {!e.vatInvoice ? (
                      <span className="block text-2xs font-normal text-muted-foreground">{t('entries.noVat')}</span>
                    ) : null}
                  </TDMoney>
                  <TD>
                    {e.status === 'VOID' ? (
                      <Badge variant="danger">{t('common:status.VOID')}</Badge>
                    ) : (
                      <Badge variant={paymentBadge[e.paymentStatus]}>{t(`common:status.${e.paymentStatus}`)}</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )
      ) : null}
    </section>
  );
}
