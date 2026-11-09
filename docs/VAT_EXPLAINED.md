# VAT, explained in plain English

*For Ahmed and Salman. This is how the system counts VAT. Your accountant files the actual
VAT returns — the system gives them exact numbers and exports.*

## The one rule to remember

**Finland's general VAT rate is 25.5 %.** Every price you charge a customer is treated as
VAT-INCLUSIVE (gross). **Exception: the till (POS).** Product prices and anything typed
into the till are WITHOUT VAT, and the till adds 25.5 % on top: €40 of labour is charged €50.20.
Shelf labels still print the price with VAT. The rate lives in Settings → VAT rates with a start date, so when
Finland changes the rate, you add a new line and old records stay correct.

## VAT collected (money you owe the tax office)

When you issue a **VAT invoice** (the "VAT invoice issued?" switch is **Yes**), part of the
money you received is VAT you collected on behalf of the state:

```
VAT = price × 25.5 / 125.5
```

**Example — the rental:** you want €200 for a monthly rental. With VAT the customer pays
**€251.00**. Of that, VAT = 251 × 25.5 / 125.5 = **€51.00**, and your net income is **€200.00**.

**Example — the repair:** a customer pays **€125.50** by bank transfer with an invoice.
VAT = **€25.50**, net = **€100.00**.

If you prefer to think net-first, the entry form has a toggle: type the net price and the
system adds VAT (€200 → €251.00).

**Discounts come first.** A €50 rental with a €5 promo discount means the customer pays €45,
and VAT is calculated on €45 — never on the price before the discount.

## Income without a VAT invoice

Money that comes in cash, Revolut, Wise, PayPal or otherwise without an invoice is recorded
with "VAT invoice issued?" = **No**. The system then counts the FULL amount in its own
**non-VAT income** column — no VAT is split out.

The system suggests the switch automatically from **who received the money** (Company
Account → Yes; Ahmed, Salman or Cash → No), but you can always change it.

> ⚠ **Important:** whether non-invoiced income really has no VAT is a tax question. The
> system shows this warning on every such entry on purpose: **your accountant must confirm
> the VAT treatment of non-invoiced income.** The VAT screen's export lists every one of
> these rows so the accountant can decide.

## VAT reclaimable (money the tax office owes you)

When the company buys something **for business use** from a **VAT-registered seller** and you
have a **valid receipt**, the VAT inside the purchase price comes back to you.

**Example:** a spare part costs **€62.75** at Sahko with a receipt.
Reclaimable VAT = 62.75 × 25.5 / 125.5 = **€12.75**. The part really cost you €50.00.

Each purchase in the system has three fields that control this:

| Field | Meaning |
|---|---|
| VAT rate | normally 25.5 %; 0 % for purchases with no VAT |
| Valid VAT receipt? | without a receipt you reclaim **nothing** |
| Business use % | a phone used 50/50 privately reclaims only half |

**Purchases that do NOT qualify:**

- anything without a proper receipt (a WhatsApp photo of a price tag is not a receipt);
- purchases from **private persons** — this includes most of your **used scooter purchases**
  (Hafiz, Prabhin, Nepali…): a private seller charges no VAT, so there is none to reclaim;
- private-use items, and the private share of mixed-use items.

That is why everything imported from the old Excel starts with "valid receipt = No" and
€0.00 reclaimable — mark the receipt box only where a real receipt exists.

## VAT payable — the number that matters

```
VAT payable = VAT collected − VAT reclaimable
```

For each period the VAT screen shows all four numbers: **collected**, **reclaimable**,
**payable** and **non-VAT income**, plus the same split per business model (rental, repair,
spare parts, unit sales). A negative payable means the tax office owes you a refund.

The **Export for accountant** button produces a PDF and an Excel that list *every single
line* behind those numbers — income entries with their VAT flags, and purchases with their
receipt status — so the accountant can file the return without asking you anything.

## Corporate tax (different thing, also handled)

Separately from VAT, the dashboard estimates corporate income tax on profit: **20 % now,
18 % from 1 January 2027** (an effective-dated table in Settings, like the VAT rates).
That estimate is for planning — the accountant computes the real tax.
