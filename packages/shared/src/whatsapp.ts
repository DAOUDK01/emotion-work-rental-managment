import { parseAmountToCents } from './money.js';
import { type ModelCode, normalizeHolderName, normalizePaymentMethod } from './types.js';

/**
 * WhatsApp entry format (pipe-separated, case-insensitive). First line = command,
 * every following line is saved as notes. Examples:
 *
 *   RENT | EE2-251001 | 45 | cash | Salman
 *   REPAIR | 80 | labour 50 parts 30 | bank | Company Account
 *   PART | brake pad | 15 | cash | Ahmed
 *   SALE | EW-251003 | 500 | bank | Company Account
 *   EXP | Jula | 59.72 | Ahmed | tools
 *
 * Extras: "45 DISC 5" or a separate "DISC 5" segment records a €5 discount.
 * A segment "VAT" / "NOVAT" overrides the VAT-invoice flag. "HELP" and "UNDO" are commands.
 * A parse error never saves anything — the reply explains what is wrong.
 */

export interface WaIncomeDraft {
  kind: 'income';
  model: Exclude<ModelCode, 'CONTRACT'>;
  unitCode?: string;
  itemName?: string;
  grossCents: number;
  discountCents: number;
  vatOverride?: boolean; // true = VAT invoice, false = NOVAT; undefined = use defaults
  paymentMethod?: string;
  receivedBy?: string;
  labourCents?: number;
  partsCents?: number;
  notes?: string;
}

export interface WaExpenseDraft {
  kind: 'expense';
  vendor: string;
  grossCents: number;
  paidBy?: string;
  category?: string;
  notes?: string;
}

export type WaParsed =
  | { ok: true; entry: WaIncomeDraft | WaExpenseDraft | { kind: 'help' } | { kind: 'undo' } }
  | { ok: false; error: string };

export const WHATSAPP_HELP_TEXT = [
  'Entry format (one line, fields separated by | ):',
  'RENT | unit | amount | payment | received by',
  'REPAIR | amount | labour 50 parts 30 | payment | received by',
  'PART | item name | amount | payment | received by',
  'SALE | unit | amount | payment | received by',
  'EXP | vendor | amount | paid by | category',
  '',
  'Payment: cash, bank, card, mobilepay, revolut, wise, paypal',
  'Received by / paid by: Ahmed, Salman, Company Account, Cash',
  'Discount: add "DISC 5" after the amount. VAT / NOVAT overrides the VAT flag.',
  'Write notes on the next line. UNDO cancels your last entry (within 10 minutes).',
].join('\n');

const FORMAT_OF: Record<string, string> = {
  RENTAL: 'RENT | unit | amount | payment | received by',
  REPAIR: 'REPAIR | amount | labour 50 parts 30 | payment | received by',
  SPARE_PARTS: 'PART | item name | amount | payment | received by',
  UNIT_SALES: 'SALE | unit | amount | payment | received by',
  EXPENSE: 'EXP | vendor | amount | paid by | category',
};

function err(message: string, format?: string): WaParsed {
  return { ok: false, error: format ? `${message}\nFormat: ${format}` : message };
}

interface AmountWithDisc {
  grossCents: number;
  discountCents: number;
}

/** Parse "45", "45,50", "45 disc 5". Returns null when not an amount. */
function parseAmountSegment(seg: string): AmountWithDisc | null {
  const m = /^(.+?)(?:\s+disc(?:ount)?\s+(\S+))?$/i.exec(seg.trim());
  if (!m) return null;
  const gross = parseAmountToCents(m[1]);
  if (gross === null || gross < 0) return null;
  let discount = 0;
  if (m[2] !== undefined) {
    const d = parseAmountToCents(m[2]);
    if (d === null || d < 0) return null;
    discount = d;
  }
  return { grossCents: gross, discountCents: discount };
}

export function parseWhatsAppMessage(text: string): WaParsed {
  const raw = (text ?? '').replace(/\r/g, '').trim();
  if (raw === '') return err('Empty message. Send HELP for the entry format.');
  const lines = raw.split('\n');
  const commandLine = lines[0].trim();
  const notes = lines.slice(1).join('\n').trim() || undefined;

  const firstWord = commandLine.split(/[\s|]+/)[0]?.toUpperCase();
  if (firstWord === 'HELP' || firstWord === '?') return { ok: true, entry: { kind: 'help' } };
  if (firstWord === 'UNDO' || firstWord === 'CANCEL') return { ok: true, entry: { kind: 'undo' } };

  const segments = commandLine
    .split('|')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (segments.length < 2) {
    return err(
      'I could not read that. Separate fields with | (vertical bar).',
      'RENT | EE2-251001 | 45 | cash | Salman — or send HELP',
    );
  }

  const keywordRaw = segments[0].toUpperCase();
  const keywordMap: Record<string, Exclude<ModelCode, 'CONTRACT'> | 'EXPENSE'> = {
    RENT: 'RENTAL',
    RENTAL: 'RENTAL',
    REPAIR: 'REPAIR',
    FIX: 'REPAIR',
    PART: 'SPARE_PARTS',
    PARTS: 'SPARE_PARTS',
    SALE: 'UNIT_SALES',
    SELL: 'UNIT_SALES',
    SOLD: 'UNIT_SALES',
    EXP: 'EXPENSE',
    EXPENSE: 'EXPENSE',
    COST: 'EXPENSE',
  };
  const type = keywordMap[keywordRaw];
  if (!type) {
    return err(
      `Unknown entry type "${segments[0]}". Use RENT, REPAIR, PART, SALE or EXP.`,
      'Send HELP for all formats.',
    );
  }

  // Pull out VAT/NOVAT and standalone DISC segments from the tail, wherever they appear.
  let vatOverride: boolean | undefined;
  let extraDiscount = 0;
  const rest: string[] = [];
  for (const seg of segments.slice(1)) {
    const u = seg.toUpperCase();
    if (u === 'VAT') {
      vatOverride = true;
      continue;
    }
    if (u === 'NOVAT' || u === 'NO VAT') {
      vatOverride = false;
      continue;
    }
    const disc = /^DISC(?:OUNT)?\s+(\S+)$/i.exec(seg);
    if (disc) {
      const d = parseAmountToCents(disc[1]);
      if (d === null || d < 0) return err(`I could not read the discount "${seg}".`, FORMAT_OF[type]);
      extraDiscount += d;
      continue;
    }
    rest.push(seg);
  }

  if (type === 'EXPENSE') {
    // EXP | vendor | amount | paid by | category
    if (rest.length < 2) return err('An expense needs a vendor and an amount.', FORMAT_OF.EXPENSE);
    const vendor = rest[0];
    const amount = parseAmountSegment(rest[1]);
    if (!amount) return err(`"${rest[1]}" is not an amount.`, FORMAT_OF.EXPENSE);
    let paidBy: string | undefined;
    let category: string | undefined;
    for (const seg of rest.slice(2)) {
      const holder = normalizeHolderName(seg);
      if (holder && !paidBy) {
        paidBy = holder;
        continue;
      }
      if (!category) {
        category = seg;
        continue;
      }
      return err(`I did not understand "${seg}".`, FORMAT_OF.EXPENSE);
    }
    return {
      ok: true,
      entry: { kind: 'expense', vendor, grossCents: amount.grossCents, paidBy, category, notes },
    };
  }

  // Income entries
  let unitCode: string | undefined;
  let itemName: string | undefined;
  let amount: AmountWithDisc | null = null;
  let tail: string[];

  if (type === 'REPAIR') {
    // REPAIR | amount | [labour/parts breakdown] | ...
    if (rest.length < 1) return err('A repair needs an amount.', FORMAT_OF.REPAIR);
    amount = parseAmountSegment(rest[0]);
    if (!amount) return err(`"${rest[0]}" is not an amount.`, FORMAT_OF.REPAIR);
    tail = rest.slice(1);
  } else {
    // RENT/SALE: unit then amount; PART: item name then amount
    if (rest.length < 2) {
      return err(
        type === 'SPARE_PARTS' ? 'A part sale needs an item name and an amount.' : 'Needs a unit and an amount.',
        FORMAT_OF[type],
      );
    }
    if (type === 'SPARE_PARTS') itemName = rest[0];
    else unitCode = rest[0];
    amount = parseAmountSegment(rest[1]);
    if (!amount) return err(`"${rest[1]}" is not an amount.`, FORMAT_OF[type]);
    tail = rest.slice(2);
  }

  let paymentMethod: string | undefined;
  let receivedBy: string | undefined;
  let labourCents: number | undefined;
  let partsCents: number | undefined;

  for (const seg of tail) {
    const breakdown = /labou?r\s+([\d.,]+)|parts?\s+([\d.,]+)/gi;
    let bm: RegExpExecArray | null;
    let matchedBreakdown = false;
    if (type === 'REPAIR') {
      while ((bm = breakdown.exec(seg)) !== null) {
        matchedBreakdown = true;
        if (bm[1] !== undefined) labourCents = parseAmountToCents(bm[1]) ?? undefined;
        if (bm[2] !== undefined) partsCents = parseAmountToCents(bm[2]) ?? undefined;
      }
      if (matchedBreakdown) continue;
    }
    const method = normalizePaymentMethod(seg);
    const holder = normalizeHolderName(seg);
    // "cash" is both a payment method and a holder; method slot fills first (matches the examples).
    if (method && !paymentMethod && !(holder === 'Ahmed' || holder === 'Salman' || holder === 'Company Account')) {
      paymentMethod = method;
      continue;
    }
    if (holder && !receivedBy) {
      receivedBy = holder;
      continue;
    }
    if (method && !paymentMethod) {
      paymentMethod = method;
      continue;
    }
    return err(
      `I did not understand "${seg}". Use a payment (cash, bank, card, mobilepay, revolut, wise, paypal) and a receiver (Ahmed, Salman, Company Account, Cash).`,
      FORMAT_OF[type],
    );
  }

  if (type === 'REPAIR' && labourCents !== undefined && partsCents !== undefined) {
    const sum = labourCents + partsCents;
    if (sum !== amount.grossCents) {
      return err(
        `Labour + parts (${(labourCents / 100).toFixed(2)} + ${(partsCents / 100).toFixed(2)}) does not equal the amount ${(amount.grossCents / 100).toFixed(2)}.`,
        FORMAT_OF.REPAIR,
      );
    }
  }

  return {
    ok: true,
    entry: {
      kind: 'income',
      model: type,
      unitCode,
      itemName,
      grossCents: amount.grossCents,
      discountCents: amount.discountCents + extraDiscount,
      vatOverride,
      paymentMethod,
      receivedBy,
      labourCents,
      partsCents,
      notes,
    },
  };
}
