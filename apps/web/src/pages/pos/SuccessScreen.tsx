import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CircleCheckBig, FileDown, Plus, Printer } from 'lucide-react';
import { downloadFile } from '@/lib/api';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Segmented } from '@/components/ui/misc';
import { errMsg, type Sale } from './types';

const WIDTH_KEY = 'emf.pos.receiptWidth';

function storedWidth(): 80 | 58 {
  try {
    return localStorage.getItem(WIDTH_KEY) === '58' ? 58 : 80;
  } catch {
    return 80;
  }
}

/** Shown after a completed sale: change due, print receipt (80/58 mm), A4 PDF, new sale. */
export function SuccessScreen({
  sale,
  changeCents,
  onNewSale,
}: {
  sale: Sale;
  changeCents: number;
  onNewSale: () => void;
}) {
  const { t } = useTranslation('pos');
  const [width, setWidth] = useState<80 | 58>(storedWidth);
  const [downloading, setDownloading] = useState(false);

  const changeWidth = (w: 80 | 58) => {
    setWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      /* storage may be unavailable */
    }
  };

  const printReceipt = () => {
    // Same-origin page: auth cookies ride along; the endpoint returns a full HTML page.
    const win = window.open(`/api/pos/sales/${sale.id}/receipt?width=${width}`, '_blank');
    if (!win) {
      toast.error(t('success.popupBlocked'));
      return;
    }
    win.onload = () => {
      win.focus();
      win.print();
    };
  };

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/pos/sales/${sale.id}/receipt?format=pdf&a4=1`, `receipt-${sale.number}.pdf`);
    } catch (err) {
      toast.error(errMsg(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Card className="mx-auto flex max-w-xl flex-col items-center gap-4 p-6 text-center sm:p-8" role="status">
      <CircleCheckBig className="h-14 w-14 text-profit" aria-hidden="true" />
      <div>
        <h2 className="text-xl font-bold">{t('success.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('success.receipt', { number: sale.number })}</p>
      </div>
      <div className="grid w-full gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-muted/50 p-4">
          <div className="text-xs text-muted-foreground">{t('totals.total')}</div>
          <div className="text-3xl font-bold tabular-nums">{fmtEUR(sale.totalGrossCents)}</div>
        </div>
        <div className="rounded-lg bg-profit/10 p-4">
          <div className="text-xs text-muted-foreground">{t('payment.change')}</div>
          <div className="text-3xl font-bold tabular-nums text-profit">{fmtEUR(changeCents)}</div>
        </div>
      </div>
      {sale.payments.length > 0 ? (
        <ul className="w-full space-y-1 text-left text-sm">
          {sale.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-2 border-b py-1 last:border-0">
              <span>
                {p.method?.name ?? t('payment.noMethod')} ·{' '}
                <span className="text-muted-foreground">{p.receivedBy.name}</span>
              </span>
              <span className="tabular-nums">{fmtEUR(p.amountCents - p.changeCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-xs text-muted-foreground">{t('success.paperWidth')}</span>
        <Segmented
          size="sm"
          value={width}
          onChange={changeWidth}
          options={[
            { value: 80 as const, label: '80 mm' },
            { value: 58 as const, label: '58 mm' },
          ]}
        />
      </div>
      <div className="grid w-full gap-2 sm:grid-cols-3">
        <Button size="pos" variant="outline" onClick={printReceipt}>
          <Printer className="h-5 w-5" /> {t('success.print')}
        </Button>
        <Button size="pos" variant="outline" onClick={() => void downloadPdf()} disabled={downloading}>
          <FileDown className="h-5 w-5" /> {t('success.a4Pdf')}
        </Button>
        <Button size="pos" onClick={onNewSale} autoFocus>
          <Plus className="h-5 w-5" /> {t('success.newSale')}
        </Button>
      </div>
    </Card>
  );
}
