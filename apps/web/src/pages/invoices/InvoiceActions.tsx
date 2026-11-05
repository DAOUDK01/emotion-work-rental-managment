import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { BellRing, Download, FileMinus, Printer, Send, Wallet } from 'lucide-react';
import { downloadFile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { CreditNoteDialog } from './CreditNoteDialog';
import { PaymentDialog, RemindDialog, SendDialog } from './InvoiceDialogs';
import { invoicePdfName, openThermalPrint, type InvoiceDetail } from './types';

type DialogKind = 'send' | 'payment' | 'remind' | 'credit' | null;

/**
 * Document + workflow actions for one invoice. `sendBlockedReason` disables Send
 * (e.g. the draft has unsaved edits); write actions are hidden from read-only roles.
 */
export function InvoiceActions({
  invoice,
  canWrite,
  sendBlockedReason,
  onDialogChange,
}: {
  invoice: InvoiceDetail;
  canWrite: boolean;
  sendBlockedReason?: string | null;
  onDialogChange?: (open: boolean) => void;
}) {
  const { t } = useTranslation('invoices');
  const [dialog, setDialogState] = useState<DialogKind>(null);
  const [downloading, setDownloading] = useState(false);

  const setDialog = useCallback(
    (d: DialogKind) => {
      setDialogState(d);
      onDialogChange?.(d !== null);
    },
    [onDialogChange],
  );
  const close = useCallback(() => setDialog(null), [setDialog]);

  const open = invoice.status === 'SENT' || invoice.status === 'PARTIALLY_PAID';
  const creditable = open || invoice.status === 'PAID';

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      await downloadFile(`/invoices/${invoice.id}/pdf`, invoicePdfName(invoice));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common:common.errorTitle'));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      {canWrite && invoice.status === 'DRAFT' ? (
        <Button
          onClick={() => setDialog('send')}
          disabled={Boolean(sendBlockedReason)}
          title={sendBlockedReason ?? undefined}
        >
          <Send className="h-4 w-4" /> {t('actions.send')}
        </Button>
      ) : null}
      {canWrite && open ? (
        <Button onClick={() => setDialog('payment')}>
          <Wallet className="h-4 w-4" /> {t('actions.recordPayment')}
        </Button>
      ) : null}
      {canWrite && invoice.isOverdue ? (
        <Button variant="outline" onClick={() => setDialog('remind')}>
          <BellRing className="h-4 w-4" /> {t('actions.remind')}
        </Button>
      ) : null}
      <Button variant="outline" onClick={() => void downloadPdf()} disabled={downloading}>
        <Download className="h-4 w-4" /> {t('common:action.downloadPdf')}
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          if (!openThermalPrint(invoice.id)) toast.error(t('actions.popupBlocked'));
        }}
      >
        <Printer className="h-4 w-4" /> {t('actions.thermal')}
      </Button>
      {canWrite && creditable ? (
        <Button variant="outline" className="text-loss" onClick={() => setDialog('credit')}>
          <FileMinus className="h-4 w-4" /> {t('actions.creditNote')}
        </Button>
      ) : null}

      <SendDialog invoice={invoice} open={dialog === 'send'} onClose={close} />
      <PaymentDialog invoice={invoice} open={dialog === 'payment'} onClose={close} />
      <RemindDialog invoice={invoice} open={dialog === 'remind'} onClose={close} />
      <CreditNoteDialog invoice={invoice} open={dialog === 'credit'} onClose={close} />
    </>
  );
}
