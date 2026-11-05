import { todayInHelsinki } from '@emotionfix/shared';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { logger } from '../../logger.js';
import { audit } from '../../services/audit.js';
import { getSetting } from '../../services/settings.js';
import { fmtEur, getAllowedNumbers } from './service.js';

/**
 * Outbound WhatsApp messages via the Meta Graph API.
 * Without an access token (local dev) nothing is sent — the text is logged and the
 * message is still marked replied so the inbox does not show it as stuck.
 */

const GRAPH_VERSION = 'v21.0';

/**
 * Send one text message. Returns true when it actually went out through the API,
 * false in dev mode (no token / phone number id configured).
 * Throws on an API failure so pg-boss retries the job.
 */
export async function sendWhatsAppText(to: string, body: string): Promise<boolean> {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    logger.info({ to, body }, 'whatsapp send skipped — no access token configured (dev mode)');
    return false;
  }
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      text: { body },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`WhatsApp send to ${to} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return true;
}

/** Job `whatsapp-reply`: deliver the stored replyText of one inbox message. */
export async function handleWhatsAppReplyJob(data: { messageId: number }): Promise<void> {
  const message = await prisma.whatsAppMessage.findUnique({ where: { id: data.messageId } });
  if (!message) {
    logger.warn({ messageId: data.messageId }, 'whatsapp reply job: message not found');
    return;
  }
  if (!message.replyText || message.repliedAt) return; // nothing to send / already sent

  const sent = await sendWhatsAppText(message.senderPhone, message.replyText);
  // Mark replied even in dev mode (log-only) so retries never spam once a token appears.
  await prisma.whatsAppMessage.update({
    where: { id: message.id },
    data: { repliedAt: new Date() },
  });
  if (sent) {
    await audit('SEND', 'whatsapp_messages', message.id, undefined, {
      to: message.senderPhone,
      replyText: message.replyText,
    });
  }
}

/**
 * Job `whatsapp-daily-summary` (daily, Europe/Helsinki): when the setting
 * `whatsapp.dailySummary` is on, send every allow-listed number today's totals —
 * entry count and gross per business model.
 */
export async function handleWhatsAppDailySummary(): Promise<void> {
  const enabled = (await getSetting<{ dailySummary?: boolean }>('whatsapp', {})).dailySummary === true;
  if (!enabled) return;
  const numbers = await getAllowedNumbers();
  if (numbers.length === 0) return;

  const today = todayInHelsinki();
  const entries = await prisma.entry.findMany({
    where: { entryDate: new Date(`${today}T00:00:00Z`), status: 'ACTIVE' },
    include: { model: { select: { nameEn: true } } },
  });

  let totalCents = 0;
  const byModel = new Map<string, { count: number; grossCents: number }>();
  for (const entry of entries) {
    totalCents += entry.grossCents;
    const agg = byModel.get(entry.model.nameEn) ?? { count: 0, grossCents: 0 };
    agg.count += 1;
    agg.grossCents += entry.grossCents;
    byModel.set(entry.model.nameEn, agg);
  }

  const lines: string[] = [`E Motion Works — daily summary ${today}`];
  if (entries.length === 0) {
    lines.push('No entries today.');
  } else {
    lines.push(`${entries.length} entries, EUR ${fmtEur(totalCents)} total.`);
    for (const [name, agg] of byModel) {
      lines.push(`${name}: ${agg.count} × EUR ${fmtEur(agg.grossCents)}`);
    }
  }
  const body = lines.join('\n');

  let delivered = 0;
  for (const to of numbers) {
    try {
      if (await sendWhatsAppText(to, body)) delivered += 1;
    } catch (err) {
      logger.error({ err, to }, 'whatsapp daily summary send failed');
    }
  }
  if (delivered > 0) {
    await audit('SEND', 'whatsapp_messages', null, undefined, {
      kind: 'daily-summary',
      date: today,
      recipients: delivered,
    });
  }
}
