# User guide — E Motion Works business system

*For Ahmed, Salman and staff. Five minutes to read.*

Sign in at your system address. Language switch (EN/FI) is in the top-right corner; each
user also has their own default language. Change your password from the user menu after the
first login.

**Roles:** Owners (Ahmed, Salman) see everything. Staff can use the POS and record entries,
but cannot open Settings, Partners, Cash & settlements or the audit log. The accountant can
read and export everything but change nothing.

---

## 1. The dashboard (your morning screen)

Top row: period buttons **Week · Month · Year · Custom dates**, then model buttons
(**All models · Rental · Repair · Spare parts · Unit sales**) and extra filters (one unit,
customer segment, received-by). Every card, chart and table follows the filters.

The cards answer the daily questions: Total sales (incl. VAT) · Expenses · **Net profit** ·
VAT payable · Discounts given · **Unpaid** (how much and how many customers) · Received vs
Outstanding · Orders · Profit margin · Rental payback on units · Tax estimate.

- **Revenue by model** — the longest bar is where to invest more.
- **Profit and loss by model** — green profit, red loss. The numbers are printed on the
  bars (never hidden in tooltips).
- **Growth by time** — the last 4 weeks for the selected model with the % change on every
  bar (switch to 8/12 weeks, months or years, or **Compare models** to see one line per model).
- **Unit performance** — every unit's rental revenue vs its purchase cost, with a payback
  bar; **Paid back** appears at 100 %.
- If a partner has been holding cash longer than the allowed days, a yellow alert appears
  at the top — go to Cash & settlements and hand it over.

**Download PDF / Excel** exports exactly what you see, for sending to each other or the bank.

## 2. Recording money — three ways

### a) WhatsApp (fastest)

Message the company number one line per entry, fields separated by `|`:

```
RENT | EE2-251001 | 45 | cash | Salman
REPAIR | 80 | labour 50 parts 30 | bank | Company Account
PART | brake pad | 15 | cash | Ahmed
SALE | EW-251003 | 500 | bank | Company Account
EXP | Jula | 59.72 | Ahmed | tools
```

Extras: `45 DISC 5` records a €5 discount · add `VAT` or `NOVAT` to override the VAT flag ·
a second line becomes the note · `HELP` returns this format · `UNDO` cancels your last entry
(within 10 minutes). The bot always confirms: *"Saved: Rental EUR 45, cash, no VAT.
Collected by Salman. Unit EE2-251001 is EUR 455 from payback."* If something is wrong it
tells you exactly what — nothing half-saved. Owners can review every WhatsApp entry under
**WhatsApp inbox**.

### b) Add entry (web form)

Date, type, unit (searchable), customer, amount, discount, **VAT invoice issued?**,
payment method and the mandatory **Amount received by**. The net/VAT split updates live as
you type. Attach a receipt photo. Separate tabs record an **Expense/Purchase** (with the
VAT-reclaim fields) or an **Investment** (cash a partner puts in).

### c) POS (counter sales)

Big-button screen that works on the tablet. Scan a barcode (USB scanner or the phone
camera) — the product, price and VAT appear and scanning again increases quantity. Or
search by name, or add a free-text line. **+ Labour** adds a work line. Discounts per line
or whole cart (staff have a personal discount limit). Take payment (split allowed, cash
change calculated), choose **who received the money**, and print the thermal receipt or an
A4 invoice, or email the PDF. Stock goes down automatically; refunds restock and create a
credit note. **Z-report** gives the end-of-day totals by model, VAT, payment method and
receiver. Unknown barcode? The POS offers to create the product with that barcode.

## 3. The no-escape cash rule

Money received by **Ahmed, Salman or Cash** is money the company is still owed. **Cash &
settlements** shows, per person: received − handed over = **currently holding**, with the
oldest unsettled receipt date. Use **Hand over to company** when you move it to the bank
account — the balance clears and the dashboard alert disappears. Every report can be
filtered by received-by, so nothing goes untracked.

## 4. Rentals and units

Create a rental with unit, customer (business customers have a Y-tunnus), dates, amount,
deposit and agreement upload. Monthly rentals: tick **recurring** and the next month's row
appears automatically (or press *Generate next*). Mark paid / invoiced / pending — unpaid
rentals feed the dashboard's Unpaid card.

Units get automatic IDs like **EE2-251001** (prefix + purchase date). Each unit shows cost,
earned (net of VAT and discounts), payback % and, when sold, profit or loss on the sale plus
the lifetime result. Rows imported from the old Excel that are missing data carry an orange
**Needs review** tag — open them and fill in what the source file didn't have.

## 5. Invoices

Create from a rental, from the POS, or from scratch (manual lines or barcode scan). The
invoice carries everything Finnish rules require: your Business ID and VAT number, sequential
number, due date, **viitenumero** with check digit, IBAN/BIC, VAT breakdown and
late-interest text — in English or Finnish per customer. Send by email as PDF, record
payments (with received-by), chase the **Overdue** list with one-click reminders, and cancel
only via credit note. Thermal (58/80 mm) and A4 layouts both print from the browser.

> Before the first real invoice: **Settings → Company** — fill in Business ID, VAT number,
> address and IBAN. They are empty on purpose.

## 6. Inventory

Products with SKU, EAN/Code128 barcodes (several per product), EN/FI names, cost and selling
price, shelf location and reorder level. **Goods receiving**: scan, enter quantity, cost and
supplier. Stock changes only through movements (sales, receiving, returns, repair use,
adjustments with a reason) — the quantity can never be silently edited. Low-stock alerts,
stock value report, and printable Code128 labels for parts without a barcode.

## 7. For the partners

**Partners** shows total invested per partner (and the joint, reinvested pot), who paid for
what by category, salaries, the 50/50 profit split after salaries, tax estimate, and who is
holding cash. Any expense a partner pays personally counts automatically as that partner's
investment.

**VAT** shows collected / reclaimable / payable / non-VAT income with the per-model table,
and exports the full line listing for the accountant (who also gets the Google Sheet mirror
and the monthly **accountant pack** Excel under Reports).

## 8. Settings worth knowing

Company details & logo · VAT and corporate tax rates (add a new line with a start date —
never edit history) · models, payment methods, received-by options, unit prefixes, expense
categories · invoice numbering and texts (EN/FI) · salaries · cash-alert days · WhatsApp
allow-listed numbers · Google Sheet · SMTP · users. **Settings → Import** shows every Excel
import with its full review list — work through the orange items once, and the old data is
as clean as the new.
