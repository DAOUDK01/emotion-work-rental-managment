import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, X } from 'lucide-react';
import { fmtDate, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { bpLabel, type VatIncomeLine, type VatModelRef, type VatPurchaseLine } from './types';

/** Rows rendered before the user asks for the rest (keeps a year view snappy). */
const INITIAL_ROWS = 100;

function CollapsibleSection({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('vat');
  const [open, setOpen] = useState(false);
  const contentId = useId();
  return (
    <Card>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold leading-tight">{title}</span>
          <span className="mt-1 block text-xs text-muted-foreground tabular-nums">{summary}</span>
        </span>
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          {open ? t('lines.hide') : t('lines.show')}
          <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <CardContent id={contentId} className="pt-0">
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}

function ShowMore({ shown, total, onShowAll }: { shown: number; total: number; onShowAll: () => void }) {
  const { t } = useTranslation('vat');
  if (shown >= total) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
      <span>{t('lines.showing', { shown, total })}</span>
      <Button variant="outline" size="sm" onClick={onShowAll}>
        {t('lines.showAll', { total })}
      </Button>
    </div>
  );
}

function ReviewBadge() {
  const { t } = useTranslation('vat');
  return (
    <Badge variant="warning" title={t('lines.reviewTooltip')}>
      {t('common:common.needsReview')}
    </Badge>
  );
}

/** Every income entry of the period — the rows composing "VAT collected" and "Non-VAT income". */
export function IncomeLinesSection({
  lines,
  modelName,
}: {
  lines: VatIncomeLine[];
  modelName: (m: VatModelRef) => string;
}) {
  const { t, i18n } = useTranslation('vat');
  const lang = i18n.language;
  const [showAll, setShowAll] = useState(false);

  let grossCents = 0;
  let vatCents = 0;
  let nonVatCents = 0;
  for (const l of lines) {
    grossCents += l.grossCents;
    if (l.vatInvoice) vatCents += l.vatCents;
    else nonVatCents += l.grossCents;
  }
  const visible = showAll ? lines : lines.slice(0, INITIAL_ROWS);

  return (
    <CollapsibleSection
      title={t('income.title')}
      summary={t('income.summary', {
        count: lines.length,
        vat: fmtEUR(vatCents),
        nonVat: fmtEUR(nonVatCents),
      })}
    >
      {lines.length === 0 ? (
        <EmptyState title={t('income.empty')} hint={t('income.emptyHint')} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('income.date')}</TH>
                <TH>{t('income.model')}</TH>
                <TH>{t('income.description')}</TH>
                <TH className="text-right">{t('income.gross')}</TH>
                <TH className="text-right">{t('income.vat')}</TH>
                <TH>{t('income.flag')}</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((l) => {
                const who = l.customer?.name ?? l.customerName;
                const context = [l.unit?.code, who].filter(Boolean).join(' · ');
                return (
                  <TR key={l.id}>
                    <TD className="whitespace-nowrap tabular-nums">{fmtDate(l.entryDate)}</TD>
                    <TD className="whitespace-nowrap">{modelName(l.model)}</TD>
                    <TD className="min-w-[12rem]">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span>{l.description || '–'}</span>
                        {l.needsReview ? <ReviewBadge /> : null}
                      </div>
                      {context ? <div className="text-2xs text-muted-foreground">{context}</div> : null}
                    </TD>
                    <TDMoney className={cn('whitespace-nowrap', l.grossCents < 0 && 'text-loss')}>
                      {fmtEUR(l.grossCents)}
                    </TDMoney>
                    <TDMoney className="whitespace-nowrap">
                      {l.vatInvoice ? (
                        <>
                          {fmtEUR(l.vatCents)}
                          <div className="text-2xs text-muted-foreground">{bpLabel(l.vatRateBp, lang)}</div>
                        </>
                      ) : (
                        '–'
                      )}
                    </TDMoney>
                    <TD>
                      {l.vatInvoice ? (
                        <Badge variant="info">{t('income.vatFlag')}</Badge>
                      ) : (
                        <Badge variant="warning">{t('income.noVatFlag')}</Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={3}>{t('common:common.total')}</TD>
                <TDMoney className="whitespace-nowrap">{fmtEUR(grossCents)}</TDMoney>
                <TDMoney className="whitespace-nowrap">{fmtEUR(vatCents)}</TDMoney>
                <TD className="whitespace-nowrap text-2xs font-normal text-muted-foreground">
                  {t('income.nonVatTotal', { amount: fmtEUR(nonVatCents) })}
                </TD>
              </TR>
            </TFoot>
          </Table>
          <ShowMore shown={visible.length} total={lines.length} onShowAll={() => setShowAll(true)} />
        </>
      )}
    </CollapsibleSection>
  );
}

/** Every dated expense of the period — the rows composing "VAT reclaimable". */
export function PurchaseLinesSection({ lines }: { lines: VatPurchaseLine[] }) {
  const { t, i18n } = useTranslation('vat');
  const lang = i18n.language;
  const [showAll, setShowAll] = useState(false);

  let grossCents = 0;
  let reclaimableCents = 0;
  for (const l of lines) {
    grossCents += l.grossCents ?? 0;
    reclaimableCents += l.reclaimableVatCents;
  }
  const visible = showAll ? lines : lines.slice(0, INITIAL_ROWS);
  const categoryName = (c: VatPurchaseLine['category']) => (lang === 'fi' ? (c.nameFi ?? c.nameEn) : c.nameEn);

  return (
    <CollapsibleSection
      title={t('purchases.title')}
      summary={t('purchases.summary', {
        count: lines.length,
        gross: fmtEUR(grossCents),
        reclaimable: fmtEUR(reclaimableCents),
      })}
    >
      {lines.length === 0 ? (
        <EmptyState title={t('purchases.empty')} hint={t('purchases.emptyHint')} />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>{t('purchases.date')}</TH>
                <TH>{t('purchases.vendor')}</TH>
                <TH>{t('purchases.description')}</TH>
                <TH className="text-right">{t('purchases.gross')}</TH>
                <TH className="text-center">{t('purchases.receipt')}</TH>
                <TH className="text-right">{t('purchases.businessPct')}</TH>
                <TH className="text-right">{t('purchases.reclaimable')}</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((l) => (
                <TR key={l.id}>
                  <TD className="whitespace-nowrap tabular-nums">{fmtDate(l.expenseDate)}</TD>
                  <TD className="whitespace-nowrap">
                    {l.vendor || '–'}
                    <div className="text-2xs text-muted-foreground">{categoryName(l.category)}</div>
                  </TD>
                  <TD className="min-w-[12rem]">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>{l.description || '–'}</span>
                      {l.needsReview ? <ReviewBadge /> : null}
                    </div>
                    {l.qtyText || l.paidBy ? (
                      <div className="text-2xs text-muted-foreground">
                        {[l.qtyText, l.paidBy ? t('purchases.paidBy', { name: l.paidBy.name }) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    ) : null}
                  </TD>
                  <TDMoney className={cn('whitespace-nowrap', l.grossCents !== null && l.grossCents < 0 && 'text-loss')}>
                    {fmtEUR(l.grossCents)}
                    <div className="text-2xs text-muted-foreground">{bpLabel(l.vatRateBp, lang)}</div>
                  </TDMoney>
                  <TD className="text-center">
                    {l.hasValidReceipt ? (
                      <span className="inline-flex text-profit" title={t('purchases.receiptYes')}>
                        <Check className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">{t('purchases.receiptYes')}</span>
                      </span>
                    ) : (
                      <span className="inline-flex text-loss" title={t('purchases.receiptNo')}>
                        <X className="h-4 w-4" aria-hidden="true" />
                        <span className="sr-only">{t('purchases.receiptNo')}</span>
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">{l.businessUsePct} %</TD>
                  <TDMoney className="whitespace-nowrap font-medium">{fmtEUR(l.reclaimableVatCents)}</TDMoney>
                </TR>
              ))}
            </TBody>
            <TFoot>
              <TR>
                <TD colSpan={3}>{t('common:common.total')}</TD>
                <TDMoney className="whitespace-nowrap">{fmtEUR(grossCents)}</TDMoney>
                <TD colSpan={2} />
                <TDMoney className="whitespace-nowrap">{fmtEUR(reclaimableCents)}</TDMoney>
              </TR>
            </TFoot>
          </Table>
          <ShowMore shown={visible.length} total={lines.length} onShowAll={() => setShowAll(true)} />
        </>
      )}
    </CollapsibleSection>
  );
}
