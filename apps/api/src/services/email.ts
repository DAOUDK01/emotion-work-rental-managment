import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { logger } from './../logger.js';
import { getSetting } from './settings.js';

/**
 * Outbox-based email: rows go to email_outbox, a job sends them via SMTP.
 * SMTP comes from Settings (admin UI) with env vars as fallback; with no SMTP
 * configured, mails stay PENDING in the outbox (visible in Settings) instead of failing.
 */

interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export async function smtpConfig(): Promise<SmtpConfig | null> {
  const fromSettings = await getSetting<Partial<SmtpConfig>>('smtp', {});
  const host = fromSettings.host || env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: fromSettings.port ?? env.SMTP_PORT,
    secure: fromSettings.secure ?? env.SMTP_SECURE,
    user: fromSettings.user ?? env.SMTP_USER,
    pass: fromSettings.pass ?? env.SMTP_PASS,
    from: fromSettings.from || env.SMTP_FROM,
  };
}

export async function queueEmail(params: {
  to: string;
  subject: string;
  bodyHtml: string;
  attachmentId?: number | null;
}): Promise<number> {
  const row = await prisma.emailOutbox.create({
    data: {
      toAddress: params.to,
      subject: params.subject,
      bodyHtml: params.bodyHtml,
      attachmentId: params.attachmentId ?? null,
    },
  });
  // try to flush soon (the scheduled job also retries every 5 minutes)
  void handleEmailOutboxJob().catch(() => {});
  return row.id;
}

let flushing = false;

export async function handleEmailOutboxJob(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const config = await smtpConfig();
    if (!config) return;
    const pending = await prisma.emailOutbox.findMany({ where: { status: 'PENDING' }, take: 20 });
    if (pending.length === 0) return;
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
    for (const mail of pending) {
      try {
        const attachments = [];
        if (mail.attachmentId) {
          const att = await prisma.attachment.findUnique({ where: { id: mail.attachmentId } });
          if (att) {
            const filePath = path.join(path.resolve(env.UPLOAD_DIR), att.path);
            if (fs.existsSync(filePath)) {
              attachments.push({ filename: att.fileName, path: filePath, contentType: att.mimeType });
            }
          }
        }
        await transport.sendMail({
          from: config.from,
          to: mail.toAddress,
          subject: mail.subject,
          html: mail.bodyHtml,
          attachments,
        });
        await prisma.emailOutbox.update({
          where: { id: mail.id },
          data: { status: 'SENT', sentAt: new Date(), error: null },
        });
      } catch (err) {
        logger.error({ err, mailId: mail.id }, 'email send failed');
        await prisma.emailOutbox.update({
          where: { id: mail.id },
          data: { status: 'ERROR', error: String((err as Error).message ?? err).slice(0, 500) },
        });
      }
    }
  } finally {
    flushing = false;
  }
}
