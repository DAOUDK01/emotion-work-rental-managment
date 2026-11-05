import { expect, test } from '@playwright/test';
import { apiOf, login, type Lookups } from '../helpers';

const PHONE = '+358401234567';

test('WhatsApp simulated entry is saved and appears in the inbox', async ({ page }) => {
  await login(page);
  const api = apiOf(page);
  await api.put('/settings/whatsapp.allowedNumbers', { value: [PHONE] });

  await page.goto('/whatsapp');
  await page.getByRole('button', { name: /Simulate message/i }).click();
  const dialog = page.getByRole('dialog', { name: /Simulate a WhatsApp message/i });
  await dialog.getByLabel(/From phone number/i).fill(PHONE);
  await dialog.getByLabel(/^Message/i).fill('PART | e2e tube | 12 | cash | Ahmed');
  await dialog.getByRole('button', { name: /^Send$/ }).click();
  await expect(dialog.getByText(/Saved: Spare parts EUR 12/i)).toBeVisible();
});

test('Quick entry: income saved with live VAT preview', async ({ page }) => {
  await login(page);
  await page.goto('/entry');
  // all three entry tabs stay mounted; only act on the visible (Income) form
  const visible = (label: RegExp) => page.getByLabel(label).locator('visible=true').first();
  await visible(/^Type/).selectOption({ label: 'Repair & maintenance' });
  await visible(/Amount € \(incl\. VAT\)/).fill('125,50');
  await visible(/Amount received by/).selectOption({ label: 'Company Account' });
  await visible(/VAT invoice issued/).check();
  // live preview: 125,50 € incl. 25,5 % VAT -> 25,50 € VAT
  await expect(page.getByText(/25[.,]50/).first()).toBeVisible();
  await page.getByRole('button', { name: /Save income/i }).click();
  await expect(page.getByText(/Saved:/).first()).toBeVisible();
});

test('Cash & settlements: hand over a partner’s cash to the company', async ({ page }) => {
  await login(page);
  const api = apiOf(page);
  const lookups = await api.get<Lookups>('/lookups');
  const holder = (n: string) => lookups.holders.find((h) => h.name === n)!.id;
  // give Salman 20 € to hold
  await api.post('/entries', {
    entryDate: new Date().toISOString().slice(0, 10),
    modelId: lookups.models.find((m) => m.code === 'SPARE_PARTS')!.id,
    description: 'e2e cash sale',
    grossBeforeDiscountCents: 2000,
    vatInvoice: false,
    vatRateBp: 2550,
    paymentStatus: 'PAID',
    receivedById: holder('Salman'),
  });
  type Balances = { balances: Array<{ holder: { name: string }; holdingCents: number }> };
  const before = (await api.get<Balances>('/cash/balances')).balances.find((b) => b.holder.name === 'Salman')!;

  await page.goto('/cash');
  await page.getByRole('button', { name: /Record handover/i }).first().click();
  const dialog = page.getByRole('dialog', { name: /Hand over money/i });
  // "From" options read "Salman — €20.00" (name + current holding)
  const fromSelect = dialog.getByLabel(/^From/);
  const salmanValue = await fromSelect.locator('option', { hasText: /^Salman/ }).getAttribute('value');
  await fromSelect.selectOption(salmanValue!);
  await dialog.getByLabel(/^To/).selectOption({ label: 'Company Account' });
  await dialog.getByLabel(/Amount/).fill('20');
  await dialog.getByRole('button', { name: /Record handover/i }).click();
  await expect(page.getByText(/handed over from Salman/i)).toBeVisible();

  const after = (await api.get<Balances>('/cash/balances')).balances.find((b) => b.holder.name === 'Salman')!;
  expect(after.holdingCents).toBe(before.holdingCents - 2000);
});
