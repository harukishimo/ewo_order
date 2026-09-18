import { expect, test, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const origin = 'http://127.0.0.1:3100';
const preferences = {
  size: 'M',
  style: 'abstract',
  budgetJpy: 20000,
  budgetAnswered: true,
  desiredDate: null,
  desiredDateAnswered: true,
  notes: 'E2E用の制作条件',
};
async function guest(request: APIRequestContext) {
  const response = await request.post('/api/auth/guest', { data: {}, headers: { origin } });
  expect(response.ok()).toBeTruthy();
  const viewer = (await response.json()).data;
  expect(viewer.isAnonymous).toBe(true);
  return viewer;
}
async function login(request: APIRequestContext, role = 'admin') {
  expect(
    (await request.post('/api/auth/demo', { data: { role }, headers: { origin } })).ok(),
  ).toBeTruthy();
}
async function create(request: APIRequestContext) {
  const response = await request.post('/api/consultations', { data: {}, headers: { origin } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}
async function ready(request: APIRequestContext) {
  const c = await create(request);
  const update = await request.patch(`/api/consultations/${c.id}/preferences`, {
    data: { preferences, expectedRevision: c.revision },
    headers: { origin },
  });
  expect(update.ok()).toBeTruthy();
  return (await update.json()).data;
}
async function quote(request: APIRequestContext, c: { id: string; revision: number }) {
  const response = await request.post(`/api/consultations/${c.id}/quotes`, {
    data: { expectedRevision: c.revision },
    headers: { origin },
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).data;
}

test('authentication, customer isolation, administrator restriction and CSRF', async ({
  request,
  playwright,
}) => {
  expect((await request.get('/api/orders')).status()).toBe(401);
  await guest(request);
  const c = await create(request);
  expect((await request.get('/api/admin/tasks')).status()).toBe(403);
  const other = await playwright.request.newContext({ baseURL: origin });
  await guest(other);
  expect((await other.get(`/api/consultations/${c.id}`)).status()).toBe(404);
  expect(
    (
      await other.patch(`/api/consultations/${c.id}/preferences`, {
        data: { preferences, expectedRevision: 0 },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post('/api/consultations', {
        data: {},
        headers: { origin: 'https://attacker.invalid' },
      })
    ).status(),
  ).toBe(403);
  await other.dispose();
});

test('price injection, stale revision and stale quote are refused', async ({ request }) => {
  await guest(request);
  const c = await ready(request);
  const q = await quote(request, c);
  expect(q.amountJpy).toBe(20000);
  expect(
    (
      await request.patch(`/api/consultations/${c.id}/preferences`, {
        data: { preferences: { ...preferences, amountJpy: 1 }, expectedRevision: c.revision },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.patch(`/api/consultations/${c.id}/preferences`, {
        data: { preferences, expectedRevision: 0 },
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await request.post('/api/orders', {
        data: {
          quoteId: q.id,
          expectedRevision: q.revision,
          idempotencyKey: randomUUID(), contactEmail: 'guest@example.com',
          amountJpy: 1,
        },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await request.patch(`/api/consultations/${c.id}/preferences`, {
        data: {
          preferences: { ...preferences, notes: '条件を変更' },
          expectedRevision: c.revision,
        },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post('/api/orders', {
        data: { quoteId: q.id, expectedRevision: q.revision, idempotencyKey: randomUUID(), contactEmail: 'guest@example.com' },
      })
    ).status(),
  ).toBe(409);
  expect((await (await request.get('/api/orders')).json()).data).toEqual([]);
});

test('concurrent confirmations create one order and unauthorized order access fails', async ({
  request,
  playwright,
}) => {
  await guest(request);
  const c = await ready(request);
  const q = await quote(request, c);
  const data = { quoteId: q.id, expectedRevision: q.revision, idempotencyKey: randomUUID(), contactEmail: 'guest@example.com' };
  const results = await Promise.all([
    request.post('/api/orders', { data }),
    request.post('/api/orders', { data }),
  ]);
  expect(results.every((r) => r.ok())).toBeTruthy();
  const orders = await Promise.all(results.map(async (r) => (await r.json()).data));
  expect(orders[0].id).toBe(orders[1].id);
  expect(orders[0].task.id).toBe(orders[1].task.id);
  expect((await (await request.get('/api/orders')).json()).data).toHaveLength(1);
  const other = await playwright.request.newContext({ baseURL: origin });
  await guest(other);
  expect((await other.get(`/api/orders/${orders[0].id}`)).status()).toBe(404);
  await other.dispose();
});

test('administrator changes are versioned, reasoned and cannot reopen completed work', async ({
  request,
  playwright,
}) => {
  await guest(request);
  const c = await ready(request);
  const q = await quote(request, c);
  const order = (
    await (
      await request.post('/api/orders', {
        data: { quoteId: q.id, expectedRevision: q.revision, idempotencyKey: randomUUID(), contactEmail: 'guest@example.com' },
      })
    ).json()
  ).data;
  const admin = await playwright.request.newContext({ baseURL: origin });
  await login(admin, 'admin');
  const path = `/api/admin/tasks/${order.task.id}`;
  let task = (await (await admin.get(path)).json()).data;
  expect(
    (
      await admin.patch(path, { data: { expectedVersion: task.version, manualPriority: 90 } })
    ).status(),
  ).toBe(422);
  const override = await admin.patch(path, {
    data: {
      expectedVersion: task.version,
      manualPriority: 90,
      overrideReason: '展示の予定日を確認したため',
    },
  });
  expect(override.ok()).toBeTruthy();
  const updated = (await override.json()).data;
  expect(updated.priorityScore).toBe(90);
  expect(updated.events.length).toBeGreaterThan(task.events.length);
  expect(
    (
      await admin.patch(path, { data: { expectedVersion: task.version, status: 'in_progress' } })
    ).status(),
  ).toBe(409);
  task = updated;
  expect(
    (
      await admin.patch(path, { data: { expectedVersion: task.version, status: 'completed' } })
    ).status(),
  ).toBe(422);
  task = (
    await (
      await admin.patch(path, { data: { expectedVersion: task.version, status: 'in_progress' } })
    ).json()
  ).data;
  task = (
    await (
      await admin.patch(path, { data: { expectedVersion: task.version, status: 'completed' } })
    ).json()
  ).data;
  expect(task.status).toBe('completed');
  expect(
    (
      await admin.patch(path, { data: { expectedVersion: task.version, status: 'queued' } })
    ).status(),
  ).toBe(422);
  expect((await (await request.get(`/api/orders/${order.id}`)).json()).data.task.status).toBe(
    'completed',
  );
  await admin.dispose();
});

test('message retries keep one message and reject reuse for different text', async ({
  request,
}) => {
  await guest(request);
  const c = await create(request);
  const clientMessageId = randomUUID();
  const data = { message: 'Mサイズの抽象画を希望', clientMessageId, expectedRevision: c.revision };
  const first = await request.post(`/api/consultations/${c.id}/messages`, { data });
  expect(first.ok()).toBeTruthy();
  const saved = (await first.json()).data;
  const retry = await request.post(`/api/consultations/${c.id}/messages`, { data });
  expect(retry.ok()).toBeTruthy();
  const retried = (await retry.json()).data;
  expect(retried.revision).toBe(saved.revision);
  expect(retried.messages).toHaveLength(saved.messages.length);
  expect(
    (
      await request.post(`/api/consultations/${c.id}/messages`, {
        data: { ...data, message: 'Sサイズへ変更' },
      })
    ).status(),
  ).toBe(409);
});


test('guest session is preserved and an order requires a valid contact email', async ({ request }) => {
  const first = await guest(request);
  const c = await ready(request);
  const second = await guest(request);
  expect(second.id).toBe(first.id);
  expect((await request.get(`/api/consultations/${c.id}`)).ok()).toBeTruthy();
  const q = await quote(request, c);
  const data = { quoteId: q.id, expectedRevision: q.revision, idempotencyKey: randomUUID() };
  for (const contactEmail of [undefined, '', 'not-an-email']) {
    expect((await request.post('/api/orders', { data: { ...data, contactEmail } })).status()).toBe(422);
  }
  expect((await (await request.get('/api/orders')).json()).data).toEqual([]);
  const response = await request.post('/api/orders', { data: { ...data, contactEmail: 'guest@example.com' } });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).data.contactEmail).toBe('guest@example.com');
});

test('guest endpoint preserves an existing administrator session and rejects cross-origin creation', async ({ request }) => {
  expect((await request.post('/api/auth/guest', { data: {}, headers: { origin: 'https://attacker.invalid' } })).status()).toBe(403);
  await login(request, 'admin');
  const response = await request.post('/api/auth/guest', { data: {}, headers: { origin } });
  expect(response.ok()).toBeTruthy();
  expect((await response.json()).data.role).toBe('admin');
  expect((await request.get('/api/admin/tasks')).ok()).toBeTruthy();
});
