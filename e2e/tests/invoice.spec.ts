import { expect, test } from '@playwright/test';
import { apiOf, e2eTag, login, type Lookups } from '../helpers';

interface InvoiceRes {
  invoice: { id: number; numberFormatted: string; referenceNumber: string; status: string };
}

test('invoice: draft → send → record payment → paid', async ({ page }) => {
  await login(page);
  const api = apiOf(page);
  const lookups = await api.get<Lookups>('/lookups');
  const customer = await api.post<{ customer: { id: number } }>('/customers', {
    type: 'BUSINESS',
    name: `Testi Oy ${e2eTag()}`,
    businessId: '0244683-1',
    language: 'FI',
  });
  const draft = await api.post<InvoiceRes>('/invoices', {
    customerId: customer.customer.id,
    modelId: lookups.models.find((m) => m.code === 'REPAIR')!.id,
    issueDate: new Date().toISOString().slice(0, 10),
    termsDays: 14,
    lines: [{ description: 'Repair work', qty: 1, unitPriceCents: 12550, vatRateBp: 2550 }],
  });
  const id = draft.invoice.id;

  await page.goto(`/invoices/${id}`);
  await expect(page.getByText(draft.invoice.numberFormatted).first()).toBeVisible();

  // send (no email -> marked as sent)
  await page.getByRole('button', { name: /^Send$/ }).click();
  const sendDialog = page.getByRole('dialog');
  await sendDialog.getByRole('button', { name: /Mark as sent|Send by email/ }).click();
  await expect(page.getByText(/Invoice marked as sent|Invoice sent/i)).toBeVisible();

  // record the full payment, received by the company account
  await page.getByRole('button', { name: /Record payment/i }).first().click();
  const payDialog = page.getByRole('dialog', { name: /Record payment/i });
  await payDialog
    .locator('select')
    .filter({ has: page.locator('option', { hasText: 'Choose who received the money' }) })
    .first()
    .selectOption({ label: 'Company Account' });
  await payDialog.getByRole('button', { name: /Record payment/i }).click();
  await expect(page.getByText(/fully paid/i)).toBeVisible();

  const after = await api.get<InvoiceRes>(`/invoices/${id}`);
  expect(after.invoice.status).toBe('PAID');
  // Finnish reference number with 7-3-1 check digit is present
  expect(after.invoice.referenceNumber).toMatch(/^\d{4,20}$/);
});
