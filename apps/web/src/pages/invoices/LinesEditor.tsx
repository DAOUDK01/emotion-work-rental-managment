import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, ScanBarcode, Trash2 } from 'lucide-react';
import { api, ApiError, qs } from '@/lib/api';
import { addVatToNet } from '@emotionfix/shared';
import { centsToInput, fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/misc';
import { Table, TBody, TD, TDMoney, TFoot, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/components/ui/utils';
import { SearchCombobox } from './SearchCombobox';
import { useWedgeScanner } from './useWedgeScanner';
import {
  blankLine,
  editorLineMath,
  fmtVatRate,
  nextLineKey,
  parseQty,
  vatBreakdown,
  type EditorLine,
  type EditorLineMath,
  type InvoiceLanguage,
  type ProductHit,
} from './types';

interface LinesEditorProps {
  lines: EditorLine[];
  setLines: React.Dispatch<React.SetStateAction<EditorLine[]>>;
  language: InvoiceLanguage;
  vatOptions: number[];
  defaultVatBp: number;
  /** Line-level problems shown after a submit attempt (key → message). */
  lineErrors: Record<string, string>;
  error?: string | null;
  scanEnabled: boolean;
}

function productName(p: Pick<ProductHit, 'nameEn' | 'nameFi'>, language: InvoiceLanguage): string {
  return language === 'FI' ? (p.nameFi ?? p.nameEn) : p.nameEn;
}

/** DRAFT invoice lines: product search / barcode scan / free text, live totals. */
export function LinesEditor({
  lines,
  setLines,
  language,
  vatOptions,
  defaultVatBp,
  lineErrors,
  error,
  scanEnabled,
}: LinesEditorProps) {
  const { t } = useTranslation('invoices');

  const addProduct = useCallback(
    (product: ProductHit) => {
      setLines((prev) => {
        const existing = prev.find((l) => l.productId === product.id);
        if (existing) {
          const qty = parseQty(existing.qty) ?? 0;
          return prev.map((l) => (l.key === existing.key ? { ...l, qty: String(Math.round((qty + 1) * 100) / 100) } : l));
        }
        const fresh: EditorLine = {
          key: nextLineKey(),
          productId: product.id,
          productSku: product.sku,
          description: productName(product, language),
          qty: '1',
          // product cards are priced without VAT; invoice unit prices include VAT
          unitPrice: centsToInput(addVatToNet(product.priceCents, product.vatRateBp).grossCents),
          discount: '',
          vatRateBp: product.vatRateBp,
          isLabour: !product.trackStock,
        };
        // replace a single untouched blank line instead of appending after it
        if (prev.length === 1 && !prev[0].productId && !prev[0].description.trim() && !prev[0].unitPrice.trim()) {
          return [fresh];
        }
        return [...prev, fresh];
      });
    },
    [setLines, language],
  );

  const lookupBarcode = useCallback(
    async (code: string) => {
      try {
        const { product } = await api.get<{ product: ProductHit }>(`/products/barcode/${encodeURIComponent(code)}`);
        addProduct(product);
        toast.success(t('lines.added', { name: productName(product, language) }));
      } catch (err) {
        if (err instanceof ApiError && (err.status === 404 || err.code === 'UNKNOWN_BARCODE')) {
          toast.error(t('lines.unknownBarcode', { code }));
        } else {
          toast.error(err instanceof Error ? err.message : t('common:common.errorTitle'));
        }
      }
    },
    [addProduct, language, t],
  );

  useWedgeScanner((code) => void lookupBarcode(code), scanEnabled);

  const update = (key: string, patch: Partial<EditorLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const remove = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const maths = useMemo(() => lines.map((l) => editorLineMath(l)), [lines]);
  const valid = maths.filter((m): m is EditorLineMath => m !== null);
  const breakdown = vatBreakdown(valid);
  const totalGross = valid.reduce((s, m) => s + m.grossCents, 0);
  const totalNet = valid.reduce((s, m) => s + m.netCents, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <SearchCombobox<ProductHit>
          className="flex-1"
          ariaLabel={t('lines.productSearch')}
          placeholder={t('lines.productSearchPlaceholder')}
          queryKey={(term) => ['products', 'list', 'invoice-search', term]}
          fetcher={async (term) =>
            (
              await api.get<{ products: ProductHit[] }>(
                '/products' + qs({ q: term || undefined, active: 'true', pageSize: 8 }),
              )
            ).products
          }
          itemKey={(p) => p.id}
          renderItem={(p) => (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{productName(p, language)}</div>
                <div className="text-2xs text-muted-foreground">
                  {p.sku}
                  {p.stockQty !== null ? ` · ${t('lines.inStock', { qty: p.stockQty })}` : ''}
                </div>
              </div>
              <span className="shrink-0 tabular-nums">{fmtEUR(addVatToNet(p.priceCents, p.vatRateBp).grossCents)}</span>
            </div>
          )}
          onPick={addProduct}
          onEnterNoMatch={(code) => void lookupBarcode(code)}
          emptyText={t('lines.noProducts')}
        />
        <Button variant="outline" onClick={() => setLines((prev) => [...prev, blankLine(defaultVatBp)])}>
          <Plus className="h-4 w-4" /> {t('lines.addFreeText')}
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-2xs text-muted-foreground">
        <ScanBarcode className="h-3.5 w-3.5" aria-hidden /> {t('lines.scanHint')}
      </p>

      {lines.length === 0 ? (
        <div
          className={cn(
            'rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground',
            error && 'border-destructive text-destructive',
          )}
        >
          {t('lines.empty')}
        </div>
      ) : (
        <Table className="min-w-[860px]">
          <THead>
            <TR>
              <TH className="w-[34%]">{t('lines.description')}</TH>
              <TH className="w-20">{t('lines.qty')}</TH>
              <TH className="w-28">{t('lines.unitPrice')}</TH>
              <TH className="w-28">{t('lines.discount')}</TH>
              <TH className="w-28">{t('lines.vat')}</TH>
              <TH className="w-16 text-center">{t('lines.labour')}</TH>
              <TH className="w-28 text-right">{t('lines.lineTotal')}</TH>
              <TH className="w-10">
                <span className="sr-only">{t('common:common.actions')}</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {lines.map((line, index) => {
              const math = maths[index];
              const lineError = lineErrors[line.key];
              const n = index + 1;
              return (
                <TR key={line.key} className="align-top hover:bg-transparent">
                  <TD>
                    <Input
                      aria-label={t('lines.descriptionN', { n })}
                      aria-invalid={Boolean(lineError) || undefined}
                      value={line.description}
                      maxLength={300}
                      placeholder={t('lines.descriptionPlaceholder')}
                      onChange={(e) => update(line.key, { description: e.target.value })}
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {line.productSku ? <Badge variant="outline">{line.productSku}</Badge> : null}
                      {lineError ? <span className="text-2xs font-medium text-destructive">{lineError}</span> : null}
                    </div>
                  </TD>
                  <TD>
                    <Input
                      aria-label={t('lines.qtyN', { n })}
                      inputMode="decimal"
                      value={line.qty}
                      onChange={(e) => update(line.key, { qty: e.target.value })}
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={t('lines.unitPriceN', { n })}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={line.unitPrice}
                      onChange={(e) => update(line.key, { unitPrice: e.target.value })}
                    />
                  </TD>
                  <TD>
                    <Input
                      aria-label={t('lines.discountN', { n })}
                      inputMode="decimal"
                      placeholder="0.00"
                      value={line.discount}
                      onChange={(e) => update(line.key, { discount: e.target.value })}
                    />
                  </TD>
                  <TD>
                    <Select
                      aria-label={t('lines.vatN', { n })}
                      value={line.vatRateBp}
                      onChange={(e) => update(line.key, { vatRateBp: Number(e.target.value) })}
                    >
                      {vatOptions.map((bp) => (
                        <option key={bp} value={bp}>
                          {fmtVatRate(bp)}
                        </option>
                      ))}
                    </Select>
                  </TD>
                  <TD className="text-center">
                    <input
                      type="checkbox"
                      aria-label={t('lines.labourN', { n })}
                      className="mt-2.5 h-4 w-4 rounded border-input accent-[hsl(var(--primary))]"
                      checked={line.isLabour}
                      onChange={(e) => update(line.key, { isLabour: e.target.checked })}
                    />
                  </TD>
                  <TDMoney className="pt-4 font-medium">
                    {math ? fmtEUR(math.grossCents) : '–'}
                    {math ? (
                      <div className="text-2xs font-normal text-muted-foreground">
                        {t('lines.vatPart', { amount: fmtEUR(math.vatCents) })}
                      </div>
                    ) : null}
                  </TDMoney>
                  <TD>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('lines.removeN', { n })}
                      onClick={() => remove(line.key)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </TBody>
          <TFoot>
            <TR>
              <TD colSpan={6} className="text-right font-normal text-muted-foreground">
                {t('totals.net')}
              </TD>
              <TDMoney>{fmtEUR(totalNet)}</TDMoney>
              <TD />
            </TR>
            {breakdown.map((row) => (
              <TR key={row.rateBp}>
                <TD colSpan={6} className="text-right font-normal text-muted-foreground">
                  {t('totals.vatAt', { rate: fmtVatRate(row.rateBp), base: fmtEUR(row.netCents) })}
                </TD>
                <TDMoney className="font-normal">{fmtEUR(row.vatCents)}</TDMoney>
                <TD />
              </TR>
            ))}
            <TR>
              <TD colSpan={6} className="text-right">
                {t('totals.gross')}
              </TD>
              <TDMoney className="text-base">{fmtEUR(totalGross)}</TDMoney>
              <TD />
            </TR>
          </TFoot>
        </Table>
      )}
      {error ? <p className="text-2xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
