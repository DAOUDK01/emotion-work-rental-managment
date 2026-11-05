import { expect, test } from '@playwright/test';
import { apiOf, e2eTag, login, type Lookups } from '../helpers';

interface ProductRow {
  id: number;
  nameEn: string;
  stockQty: number | null;
}

test('POS sale: search, add to cart, pay with received-by, stock goes down', async ({ page }) => {
  await login(page);
  const api = apiOf(page);
  const name = `Brake pad ${e2eTag()}`;
  const lookups = await api.get<Lookups>('/lookups');
  await api.post('/products', {
    nameEn: name,
    priceCents: 1500,
    costCents: 700,
    vatRateBp: 2550,
    trackStock: true,
    initialStock: 5,
  });

  await page.goto('/pos');
  const search = page.getByPlaceholder(/Search products by name, SKU or barcode/i);
  await search.fill(name);
  await expect(page.getByText(name).first()).toBeVisible();
  await search.press('Enter');

  // the product is in the cart and the PAY button carries the total
  await expect(page.getByRole('button', { name: /PAY/ })).toBeEnabled();
  await page.getByRole('button', { name: /PAY/ }).click();

  const dialog = page.getByRole('dialog', { name: /Payment/i });
  await expect(dialog).toBeVisible();
  // "Amount received by" is mandatory: pick Company Account in the receiver select
  const receiver = dialog.locator('select').filter({ has: page.locator('option', { hasText: 'Choose who received it' }) }).first();
  await receiver.selectOption({ label: 'Company Account' });
  await dialog.getByRole('button', { name: /Confirm payment/i }).click();

  await expect(page.getByText(/Payment received/i)).toBeVisible();

  const products = await api.get<{ products: ProductRow[] }>(`/products?q=${encodeURIComponent(name)}`);
  expect(products.products[0].stockQty).toBe(4);
  expect(lookups.holders.some((h) => h.name === 'Company Account')).toBe(true);
});

test('POS Z-report opens for today', async ({ page }) => {
  await login(page);
  await page.goto('/pos');
  await page.getByRole('button', { name: /Z-report/i }).click();
  await expect(page.getByRole('dialog', { name: /Z-report/i })).toBeVisible();
});
