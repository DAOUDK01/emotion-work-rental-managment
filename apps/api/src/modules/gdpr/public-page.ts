import type { Request, Response, NextFunction } from 'express';
import { resolvePrivacyNotice } from './notice.js';

/**
 * Public privacy policy page (GET /api/privacy, no login). Meta requires a public
 * privacy policy URL before a WhatsApp app can be published; this serves the same
 * notice admins print for customers, plus a section on the WhatsApp bot.
 */

const WHATSAPP_EN = `WHATSAPP MESSAGES
The company's WhatsApp number is used by the owners and staff to record sales and expenses
through the official WhatsApp Business Platform (Meta). For each message we store the sender's
phone number, the message text, the time and our reply, so that every entry can be checked later.
Messages are processed by Meta as part of the WhatsApp service. We do not use WhatsApp for
marketing and we only answer numbers on our allow-list.`;

const WHATSAPP_FI = `WHATSAPP-VIESTIT
Yrityksen WhatsApp-numeroa käyttävät omistajat ja henkilökunta myyntien ja kulujen
kirjaamiseen virallisen WhatsApp Business -alustan (Meta) kautta. Jokaisesta viestistä
tallennamme lähettäjän puhelinnumeron, viestin tekstin, ajan ja vastauksemme, jotta jokainen
kirjaus voidaan tarkistaa jälkikäteen. Meta käsittelee viestit osana WhatsApp-palvelua.
Emme käytä WhatsAppia markkinointiin ja vastaamme vain sallittujen numeroiden viesteihin.`;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export async function publicPrivacyPage(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { textEn, textFi } = await resolvePrivacyNotice();
    const section = (lang: string, body: string) =>
      `<section lang="${lang}"><pre>${escapeHtml(body)}</pre></section>`;
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Privacy policy — E Motion Works Oy</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 0 auto; padding: 24px 16px; color: #111; background: #fff; line-height: 1.5; }
  pre { white-space: pre-wrap; font-family: inherit; margin: 0 0 16px; }
  hr { border: 0; border-top: 1px solid #ddd; margin: 32px 0; }
</style>
</head>
<body>
${section('en', `${textEn}\n\n${WHATSAPP_EN}`)}
<hr>
${section('fi', `${textFi}\n\n${WHATSAPP_FI}`)}
</body>
</html>`);
  } catch (err) {
    next(err);
  }
}
