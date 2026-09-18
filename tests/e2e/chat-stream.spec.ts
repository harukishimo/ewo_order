import { expect, test } from '@playwright/test';

test('chat proposals are messages and require a separate conversational approval', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '絵を相談する' }).first().click();
  await expect(page).toHaveURL(/\/consultations\//);
  const composer = page.getByLabel('ご希望を入力');
  await composer.fill('Mサイズの抽象画が希望です');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(composer).toBeEnabled();
  const chat = page.getByRole('log', { name: '相談メッセージ' });
  await expect(chat).toContainText('M');
  await expect(page.locator('.candidate-box')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'テイスト', exact: true })).toHaveValue('');
  await composer.fill('それでお願いします');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'テイスト', exact: true })).toHaveValue(
    'abstract',
  );
  await expect(page.getByRole('button', { name: /M.*30/ })).toHaveAttribute('aria-pressed', 'true');
  expect((await (await page.request.get('/api/orders')).json()).data).toEqual([]);
  await page.reload();
  await expect(chat).toContainText('それでお願いします');
  await expect(page.getByRole('combobox', { name: 'テイスト', exact: true })).toHaveValue(
    'abstract',
  );
});
