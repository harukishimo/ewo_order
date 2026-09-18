import { expect, test, type Page } from '@playwright/test';

test('customer consults, explicitly approves, administrator produces, customer sees completion', async ({
  page,
  browser,
}) => {
  await page.goto('/');
  await capture(page, 'home');
  await page.getByRole('button', { name: '絵を相談する' }).first().click();
  await expect(page).toHaveURL(/\/consultations\//);
  await page.getByLabel('ご希望を入力').fill('Mサイズで青系の抽象画がほしいです');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeVisible();
  await expect(page.getByText('ご希望の候補', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'テイスト', exact: true })).toHaveValue('');
  await page.getByLabel('ご希望を入力').fill('それでお願いします');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'テイスト', exact: true })).toHaveValue(
    'abstract',
  );
  await page.getByLabel('ご予算（円）', { exact: true }).fill('20000');
  await page.getByLabel('希望日の指定なし', { exact: true }).check();
  await page.getByLabel('色・用途・そのほかのご希望').fill('リビング用の落ち着いた青系');
  await page.getByRole('button', { name: '条件を保存する', exact: true }).click();
  await expect(page.getByRole('button', { name: '見積もりを確認', exact: true })).toBeEnabled();
  const before = await page.request.get('/api/orders');
  expect((await before.json()).data).toEqual([]);
  await page.getByRole('button', { name: '見積もりを確認', exact: true }).click();
  const confirmation = page.getByRole('region', { name: '注文の最終確認' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText('20,000');
  await capture(page, 'consultation-confirmation');
  expect((await (await page.request.get('/api/orders')).json()).data).toEqual([]);
  const email = page.getByLabel('連絡用メールアドレス', { exact: true });
  await expect(email).toBeVisible();
  await page.getByRole('button', { name: 'この内容で注文する', exact: true }).click();
  await expect(confirmation).toBeVisible();
  expect((await (await page.request.get('/api/orders')).json()).data).toEqual([]);
  await email.fill('guest@example.com');
  await page.getByRole('button', { name: 'この内容で注文する', exact: true }).click();
  await expect(page).toHaveURL(/\/orders\//);
  const orderId = page.url().split('/').pop();
  const order = (await (await page.request.get(`/api/orders/${orderId}`)).json()).data;
  expect(order.amountJpy).toBe(20000);
  expect(order.contactEmail).toBe('guest@example.com');
  await expect(page.getByText('guest@example.com', { exact: true })).toBeVisible();

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await admin.goto('http://127.0.0.1:3100/login');
  await admin.getByRole('button', { name: '管理者として試す', exact: true }).click();
  await expect(admin.getByRole('heading', { name: '制作ボード', exact: true })).toBeVisible();
  await capture(admin, 'admin-board');
  await admin.getByRole('link', { name: `${order.orderNumber}の制作詳細` }).click();
  await expect(admin.getByRole('button', { name: '制作を開始', exact: true })).toBeVisible();
  await capture(admin, 'admin-detail');
  await admin.getByRole('button', { name: '制作を開始', exact: true }).click();
  await expect(admin.getByRole('button', { name: '制作を完了', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '進捗を更新', exact: true }).click();
  await expect(page.getByRole('heading', { name: '制作中', exact: true })).toBeVisible();
  await admin.getByRole('button', { name: '制作を完了', exact: true }).click();
  await expect(admin.getByText('この制作タスクは終了しています。')).toBeVisible();
  await page.getByRole('button', { name: '進捗を更新', exact: true }).click();
  await expect(page.getByRole('heading', { name: '制作完了', exact: true })).toBeVisible();
  await expect(admin.getByRole('heading', { name: '変更履歴', exact: true })).toBeVisible();
  await adminContext.close();
});

async function capture(page: Page, name: string) {
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}
