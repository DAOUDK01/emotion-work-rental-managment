import { useTranslation } from 'react-i18next';
import {
  Minus,
  NotebookPen,
  PauseCircle,
  Percent,
  Plus,
  ShoppingCart,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react';
import { fmtEUR, fmtNumber } from '@/lib/format';
import { cn } from '@/components/ui/utils';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge, EmptyState, ErrorState, LoadingState } from '@/components/ui/misc';
import {
  fmtVatRate,
  lineAmountCents,
  modelName,
  productName,
  saleExclVat,
  type Sale,
  type SaleLine,
  type SaleSummary,
} from './types';

export interface CartActions {
  onQty: (line: SaleLine, qty: number) => void;
  onRemove: (line: SaleLine) => void;
  onLineDiscount: (line: SaleLine) => void;
  onLabour: () => void;
  onFreeLine: () => void;
  onCartDiscount: () => void;
  onDetails: () => void;
  onPark: () => void;
  onVoidSale: () => void;
  onPay: () => void;
  onResume: (id: number) => void;
}

function TotalRow({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-2 text-sm', className)}>
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** Right POS pane: cart lines, line tools, totals and the PAY button. */
export function CartPane({
  sale,
  loading,
  error,
  onRetry,
  busy,
  resumable,
  actions,
}: {
  sale: Sale | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  busy: boolean;
  resumable: SaleSummary[];
  actions: CartActions;
}) {
  const { t, i18n } = useTranslation('pos');
  const lang = i18n.language;
  const lines = sale?.lines ?? [];
  const hasLines = lines.length > 0;
  const exclVat = saleExclVat(sale);
  const subtotalCents = lines.reduce((s, l) => s + lineAmountCents(l, exclVat) + l.discountCents, 0);

  return (
    <Card className="flex min-h-[28rem] flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]">
      {/* header: receipt number, model, customer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <ShoppingCart className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold">{sale ? sale.number : t('cart.newSale')}</p>
            <p className="truncate text-xs text-muted-foreground">
              {sale ? modelName(sale.model, lang) : t('cart.notStarted')}
              {' · '}
              {sale?.customer?.name ?? t('cart.walkIn')}
              {sale?.unit ? ` · ${sale.unit.code}` : ''}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={actions.onDetails} disabled={busy}>
          <UserRound className="h-4 w-4" /> {t('cart.details')}
        </Button>
      </div>

      {/* resume chips (only when no sale is open) */}
      {!sale && resumable.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 p-3">
          <span className="text-xs font-medium text-muted-foreground">{t('cart.resumeParked')}</span>
          {resumable.slice(0, 6).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => actions.onResume(s.id)}
              className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {s.number} · {fmtEUR(s.totalGrossCents)}
            </button>
          ))}
        </div>
      ) : null}

      {/* lines */}
      <div className="flex-1 overflow-y-auto p-3" aria-live="polite">
        {loading ? <LoadingState label={t('common:common.loading')} /> : null}
        {!loading && error ? <ErrorState error={error} onRetry={onRetry} /> : null}
        {!loading && !error && !hasLines ? (
          <EmptyState title={t('cart.empty')} hint={t('cart.emptyHint')} />
        ) : null}
        {!loading && !error && hasLines ? (
          <ul className="divide-y" aria-label={t('cart.title')}>
            {lines.map((line) => {
              const name = line.product ? productName(line.product, lang) : line.description;
              return (
                <li key={line.id} className="space-y-2 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-snug">
                        {name}{' '}
                        {line.isLabour ? <Badge variant="info">{t('cart.labour')}</Badge> : null}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {fmtNumber(line.qty)} × {fmtEUR(line.unitPriceCents)} · {t('cart.vat')}{' '}
                        {fmtVatRate(line.vatRateBp, lang)}
                      </p>
                      {line.discountCents > 0 ? (
                        <p className="text-xs font-medium text-loss" title={line.discountReason ?? undefined}>
                          {t('cart.lineDiscount', { amount: fmtEUR(line.discountCents) })}
                          {line.discountReason ? ` — ${line.discountReason}` : ''}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-base font-semibold tabular-nums">{fmtEUR(lineAmountCents(line, exclVat))}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => actions.onQty(line, line.qty - 1)}
                      disabled={busy || line.qty <= 1}
                      aria-label={t('cart.decrease', { name })}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-10 text-center text-base font-semibold tabular-nums" aria-label={t('cart.qty')}>
                      {fmtNumber(line.qty)}
                    </span>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-10 w-10"
                      onClick={() => actions.onQty(line, line.qty + 1)}
                      disabled={busy}
                      aria-label={t('cart.increase', { name })}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <div className="ml-auto flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10"
                        onClick={() => actions.onLineDiscount(line)}
                        disabled={busy}
                        aria-label={t('cart.discountFor', { name })}
                      >
                        <Percent className="h-4 w-4" />
                        <span className="hidden sm:inline">{t('cart.discount')}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 text-destructive"
                        onClick={() => actions.onRemove(line)}
                        disabled={busy}
                        aria-label={t('cart.remove', { name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {/* line tools */}
      <div className="grid grid-cols-3 gap-2 border-t p-3">
        <Button variant="secondary" size="pos" className="px-2 text-sm" onClick={actions.onLabour} disabled={busy}>
          <Wrench className="h-4 w-4" /> {t('cart.addLabour')}
        </Button>
        <Button variant="secondary" size="pos" className="px-2 text-sm" onClick={actions.onFreeLine} disabled={busy}>
          <NotebookPen className="h-4 w-4" /> {t('cart.addFree')}
        </Button>
        <Button
          variant="secondary"
          size="pos"
          className="px-2 text-sm"
          onClick={actions.onCartDiscount}
          disabled={busy || !hasLines}
        >
          <Percent className="h-4 w-4" /> {t('cart.cartDiscount')}
        </Button>
      </div>

      {/* totals */}
      <div className="space-y-1 border-t p-3">
        <TotalRow
          label={exclVat ? t('totals.subtotalExclVat') : t('totals.subtotal')}
          value={fmtEUR(subtotalCents)}
        />
        <TotalRow
          label={t('totals.discounts')}
          value={sale && sale.discountCents > 0 ? fmtEUR(-sale.discountCents) : fmtEUR(0)}
          className={sale && sale.discountCents > 0 ? 'text-loss' : undefined}
        />
        {sale && sale.cartDiscountCents > 0 && sale.cartDiscountReason ? (
          <p className="text-right text-2xs text-muted-foreground">
            {t('totals.cartDiscountReason', { reason: sale.cartDiscountReason })}
          </p>
        ) : null}
        <TotalRow
          label={exclVat ? t('totals.vatAdded') : t('totals.vatIncluded')}
          value={fmtEUR(sale?.totalVatCents ?? 0)}
        />
        <div className="flex items-baseline justify-between gap-2 pt-1">
          <span className="text-base font-semibold">{t('totals.total')}</span>
          <span className="text-4xl font-bold tabular-nums tracking-tight">{fmtEUR(sale?.totalGrossCents ?? 0)}</span>
        </div>
      </div>

      {/* park / void / pay */}
      <div className="grid grid-cols-[auto_auto_1fr] gap-2 border-t p-3">
        <Button variant="outline" size="pos" onClick={actions.onPark} disabled={busy || !hasLines}>
          <PauseCircle className="h-5 w-5" /> <span className="hidden sm:inline">{t('cart.park')}</span>
        </Button>
        <Button
          variant="outline"
          size="pos"
          onClick={actions.onVoidSale}
          disabled={busy || !sale}
          aria-label={t('cart.voidSale')}
          title={t('cart.voidSale')}
        >
          <Trash2 className="h-5 w-5 text-destructive" />
        </Button>
        <Button
          variant="accent"
          size="pos"
          className="text-lg font-bold"
          onClick={actions.onPay}
          disabled={busy || !hasLines || (sale?.totalGrossCents ?? 0) <= 0}
        >
          {t('cart.pay')} {hasLines ? fmtEUR(sale?.totalGrossCents ?? 0) : ''}
        </Button>
      </div>
    </Card>
  );
}
