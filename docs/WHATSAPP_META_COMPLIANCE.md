# WhatsApp integration — how it works and why it's built this way

*For Ahmed and Salman, in plain English.*

## The short version

Your entries go to a **dedicated company WhatsApp number** run on **Meta's official
WhatsApp Business Cloud API**. You message that number like a contact:

```
RENT | EE2-251001 | 45 | cash | Salman
```

…and the system replies with a confirmation and saves the entry. This is the only way to
connect WhatsApp that Meta allows for software.

## Official API vs. "WhatsApp bots" you may have seen

There are unofficial libraries (whatsapp-web.js, Baileys and similar) that log in **as a
personal WhatsApp account** and read everything, including groups. We deliberately did NOT
use them, because:

- they **violate WhatsApp's Terms of Service** — Meta detects them and **bans the number**,
  sometimes within days. Losing the company number mid-season is a real business risk;
- they break every time WhatsApp updates;
- they offer no uptime or security guarantees, and your customer chats would flow through
  reverse-engineered code.

The official Cloud API is free to receive messages, stable, and ban-proof — but it works
**1-to-1 with the business number**, not inside your private group.

## What about our group?

Meta's Cloud API cannot read your private group chat today. The workflow becomes:

1. Each partner sends entries **directly to the company number** (same format as before).
2. The bot confirms each entry instantly ("Saved: Rental EUR 45…"), so nothing is forgotten.
3. Optionally the bot sends each partner a **daily summary** (Settings → WhatsApp), which
   replaces the "overview" function of the group.

If Meta later opens its Groups API to accounts like yours, the system has a feature flag
(`whatsapp.groupFeatureFlag`) reserved so group support can be added without rebuilding.

## What Meta requires from you (one-time setup)

1. **A Meta Business account**, verified (business documents — your Y-tunnus extract works).
2. **A WhatsApp Business account** with a phone number that is **not** currently used on a
   personal WhatsApp (buy a cheap prepaid SIM for this).
3. A **display name** ("E Motion Works") that Meta approves — it must match your business.
4. In the Meta developer console: create an app, add the WhatsApp product, set the
   **webhook URL** to `https://<your-domain>/api/whatsapp/webhook` with the **verify token**
   from your `.env`, and subscribe to `messages`.
5. Copy the **access token**, **app secret** and **phone number ID** into the server's `.env`.

Security built in: the webhook checks Meta's cryptographic signature
(`X-Hub-Signature-256`) on every delivery, ignores duplicate deliveries, and only accepts
entries from the **allow-listed partner numbers** you set in Settings → WhatsApp. Anyone
else who messages the number cannot create entries.

## The 24-hour window and message templates

WhatsApp's rules: when **you message the bot first**, it may reply freely for 24 hours —
which covers every confirmation reply, because the bot only replies to your messages.
If we later want the bot to message you **first** (e.g. a morning summary when you haven't
written anything for a day), that message must use a **pre-approved template**; Meta approval
takes a day or two. The daily summary currently rides on the service window and is sent
only where allowed.

## Pricing basics

- Receiving messages: **free**.
- Service replies inside the 24-hour window: free on the current Cloud API pricing
  (Meta moved to per-message pricing for *template/marketing* messages; plain service
  conversations with your own two numbers cost nothing or close to nothing).
- Budget impact for two partners entering data: effectively **€0/month**.

## Privacy & GDPR

- The system stores, for each entry: the **sender's phone number**, the **message text**, a
  Meta message ID, timestamps and the parsed entry. That is the minimum needed to keep an
  audit trail of who recorded what (the "no escape point" principle).
- Messages from numbers not on the allow-list are stored only as rejected log rows (so you
  can see someone tried) and can be deleted from the inbox.
- Meta processes the message in transit as a **data processor**; their Business Data
  Processing Terms apply. Do not send customer personal data in entry messages — the format
  needs none (unit, amount, payer, receiver).
- Data retention follows the bookkeeping law: entries are financial records (6 years).
  The raw WhatsApp inbox can be pruned from Settings without touching the entries.

## Why this design complies

- Only Meta's official, documented API endpoints are used, server-to-server.
- No personal WhatsApp session is automated; no group content is scraped.
- Webhook signature verification + allow-list + idempotency protect against spoofed input.
- Nothing is ever half-saved: a message either parses completely and saves with a
  confirmation, or it fails with an explanation and saves nothing.
