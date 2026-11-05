import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Ban, ExternalLink, RotateCcw } from 'lucide-react';
import { fmtEUR } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { fmtDateTime, statusVariant, type InboxEntry, type InboxExpense, type WaMessage } from './types';

const PREVIEW_CHARS = 90;

/** The inbox table: one row per stored WhatsApp message. */
export function InboxTable({
  messages,
  canAct,
  onReject,
  onReparse,
}: {
  messages: WaMessage[];
  canAct: boolean;
  onReject: (m: WaMessage) => void;
  onReparse: (m: WaMessage) => void;
}) {
  const { t } = useTranslation('whatsapp');
  return (
    <Table>
      <THead>
        <TR>
          <TH className="whitespace-nowrap">{t('table.receivedAt')}</TH>
          <TH>{t('table.sender')}</TH>
          <TH className="min-w-[220px]">{t('table.message')}</TH>
          <TH>{t('common:common.status')}</TH>
          <TH className="min-w-[180px]">{t('table.parsed')}</TH>
          <TH className="min-w-[180px]">{t('table.reply')}</TH>
          {canAct ? <TH className="text-right">{t('common:common.actions')}</TH> : null}
        </TR>
      </THead>
      <TBody>
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} canAct={canAct} onReject={onReject} onReparse={onReparse} />
        ))}
      </TBody>
    </Table>
  );
}

function MessageRow({
  message: m,
  canAct,
  onReject,
  onReparse,
}: {
  message: WaMessage;
  canAct: boolean;
  onReject: (m: WaMessage) => void;
  onReparse: (m: WaMessage) => void;
}) {
  const { t, i18n } = useTranslation('whatsapp');
  const canReparse = m.status === 'ERROR' || m.status === 'REJECTED';
  const canReject = m.status !== 'REJECTED';

  return (
    <TR className="align-top">
      <TD className="whitespace-nowrap align-top text-xs tabular-nums">{fmtDateTime(m.receivedAt, i18n.language)}</TD>
      <TD className="align-top">
        <div className="whitespace-nowrap font-mono text-xs">{m.senderPhone}</div>
        {m.senderName ? <div className="text-2xs text-muted-foreground">{m.senderName}</div> : null}
      </TD>
      <TD className="align-top">
        <RawText text={m.rawText} id={m.id} />
      </TD>
      <TD className="align-top">
        <Badge variant={statusVariant(m.status)}>{t(`status.${m.status}`)}</Badge>
        {m.errorText && (m.status === 'ERROR' || m.status === 'REJECTED') ? (
          <p className="mt-1 max-w-[200px] whitespace-pre-line text-2xs text-loss">{m.errorText}</p>
        ) : null}
        {m.status === 'UNDONE' && m.undoneAt ? (
          <p className="mt-1 whitespace-nowrap text-2xs text-muted-foreground">
            {t('table.undoneAt', { time: fmtDateTime(m.undoneAt, i18n.language) })}
          </p>
        ) : null}
      </TD>
      <TD className="align-top">
        <ParsedSummary message={m} />
      </TD>
      <TD className="align-top">
        {m.replyText ? (
          <p className="max-w-[260px] whitespace-pre-line text-xs text-muted-foreground">{m.replyText}</p>
        ) : (
          <span className="text-xs text-muted-foreground">{t('table.noReply')}</span>
        )}
      </TD>
      {canAct ? (
        <TD className="align-top">
          <div className="flex flex-col items-end gap-1.5">
            {canReparse ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onReparse(m)}
                title={t('reparse.tooltip')}
                aria-label={`${t('actions.reparse')} #${m.id}`}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> {t('actions.reparse')}
              </Button>
            ) : null}
            {canReject ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-loss hover:text-loss"
                onClick={() => onReject(m)}
                title={t('reject.tooltip')}
                aria-label={`${t('actions.reject')} #${m.id}`}
              >
                <Ban className="h-3.5 w-3.5" aria-hidden="true" /> {t('actions.reject')}
              </Button>
            ) : null}
          </div>
        </TD>
      ) : null}
    </TR>
  );
}

/** Raw message in a monospace block; long / multi-line messages collapse with a toggle. */
function RawText({ text, id }: { text: string; id: number }) {
  const { t } = useTranslation('whatsapp');
  const [expanded, setExpanded] = useState(false);
  const firstLine = text.split('\n')[0] ?? '';
  const isLong = text.length > PREVIEW_CHARS || text.includes('\n');
  const preview = firstLine.length > PREVIEW_CHARS ? `${firstLine.slice(0, PREVIEW_CHARS)}…` : `${firstLine}${isLong ? ' …' : ''}`;
  const blockId = `wa-raw-${id}`;
  return (
    <div className="max-w-[340px]">
      <pre
        id={blockId}
        className="whitespace-pre-wrap break-words rounded-md bg-muted px-2 py-1.5 font-mono text-xs leading-relaxed"
      >
        {expanded || !isLong ? text : preview}
      </pre>
      {isLong ? (
        <button
          type="button"
          className="mt-1 rounded text-2xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-controls={blockId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('actions.showLess') : t('actions.showMore')}
        </button>
      ) : null}
    </div>
  );
}

function ParsedSummary({ message: m }: { message: WaMessage }) {
  const { t } = useTranslation('whatsapp');
  if (m.entry) return <EntrySummary entry={m.entry} />;
  if (m.expense) return <ExpenseSummary expense={m.expense} />;
  if (m.status === 'RECEIVED') {
    return <span className="text-xs text-muted-foreground">{t('summary.command')}</span>;
  }
  return <span className="text-xs text-muted-foreground">{t('summary.nothing')}</span>;
}

function EntrySummary({ entry }: { entry: InboxEntry }) {
  const { t } = useTranslation('whatsapp');
  const voided = entry.status === 'VOID';
  const modelName = t(`models.${entry.model.code}`, { defaultValue: entry.model.nameEn });
  const details = [
    entry.unit ? t('summary.unit', { code: entry.unit.code }) : null,
    entry.receivedBy ? t('summary.receivedBy', { name: entry.receivedBy.name }) : t('summary.pending'),
    entry.vatInvoice ? t('summary.vat') : t('summary.noVat'),
  ].filter((x): x is string => x !== null);
  return (
    <div className="space-y-0.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={voided ? 'font-semibold line-through' : 'font-semibold'}>
          {modelName} · <span className="tabular-nums">{fmtEUR(entry.grossCents)}</span>
        </span>
        {voided ? <Badge variant="danger">{t('summary.voided')}</Badge> : null}
      </div>
      <div className="text-2xs text-muted-foreground">{details.join(' · ')}</div>
      <Link
        to="/entry"
        className="inline-flex items-center gap-1 rounded text-2xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={t('summary.openEntriesHint')}
      >
        {t('summary.entry', { id: entry.id })} <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}

function ExpenseSummary({ expense }: { expense: InboxExpense }) {
  const { t } = useTranslation('whatsapp');
  const voided = expense.status === 'VOID';
  const details = [
    expense.category ? expense.category.nameEn : null,
    expense.paidBy ? t('summary.paidBy', { name: expense.paidBy.name }) : null,
  ].filter((x): x is string => x !== null);
  return (
    <div className="space-y-0.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={voided ? 'font-semibold line-through' : 'font-semibold'}>
          {expense.vendor ?? expense.description} · <span className="tabular-nums">{fmtEUR(expense.grossCents)}</span>
        </span>
        {voided ? <Badge variant="danger">{t('summary.voided')}</Badge> : null}
      </div>
      {details.length ? <div className="text-2xs text-muted-foreground">{details.join(' · ')}</div> : null}
      <Link
        to="/expenses"
        className="inline-flex items-center gap-1 rounded text-2xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        title={t('summary.openExpensesHint')}
      >
        {t('summary.expense', { id: expense.id })} <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </Link>
    </div>
  );
}
