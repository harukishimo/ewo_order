import { expect, test } from '@playwright/test';

test('explains an over-budget size and allows a quote after the customer saves an affordable size', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '絵を相談する' }).first().click();
  await expect(page).toHaveURL(/\/consultations\//);

  await page.getByRole('button', { name: /^L / }).click();
  await page.getByRole('combobox', { name: 'テイスト', exact: true }).selectOption('botanical');
  await page.getByLabel('ご予算（円）', { exact: true }).fill('20000');
  await page.getByLabel('希望日の指定なし', { exact: true }).check();
  await page.getByRole('button', { name: '条件を保存する', exact: true }).click();

  const quoteButton = page.getByRole('button', { name: '見積もりを確認', exact: true });
  await expect(quoteButton).toBeDisabled();
  await expect(page.getByText(/Lサイズのデモ料金は35,000円で、ご予算20,000円を15,000円超えています/)).toBeVisible();
  await expect(page.getByRole('button', { name: /^L / })).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('button', { name: /^M / }).click();
  await expect(quoteButton).toBeDisabled();
  await page.getByRole('button', { name: '条件を保存する', exact: true }).click();
  await expect(quoteButton).toBeEnabled();
  await quoteButton.click();

  const confirmation = page.getByRole('region', { name: '注文の最終確認' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('20,000');
  expect((await (await page.request.get('/api/orders')).json()).data).toEqual([]);
});
